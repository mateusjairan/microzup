/**
 * Cliente HTTP do Microzup (web).
 *
 * - Access token vive SÓ em memória; o refresh token é cookie HttpOnly emitido
 *   pelo servidor — o JavaScript nunca o vê, nem para gravá-lo em localStorage.
 * - Refresh proativo: chama /auth/refresh ANTES do access expirar (margem de
 *   segurança de 90 s) e refaz o agendamento a cada rotação.
 * - 401 em chamada autenticada → um único refresh + retry da chamada original.
 * - Refresh definitivamente inválido → estado "sessionExpired" (listeners) e
 *   logout limpo no servidor (best-effort). O composer/rascunho NÃO é destruído.
 * - Upload/download via XMLHttpRequest porque fetch não expõe progresso.
 * - Mesma origem: o SPA é servido pelo próprio backend, então os caminhos são
 *   relativos e os cookies viajam em `credentials: "same-origin"`.
 *
 * Tipos de resposta vêm do OpenAPI gerado (types/api.ts).
 */
import type { components } from "../types/api";
import type { Conversation, ConversationSummary, DirectoryUser, Message, User } from "../types";
import { parseConversationKind, parsePresence, parseRole } from "../types/client";

type Schemas = components["schemas"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ProgressInfo {
  loaded: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Estado de sessão (access em memória; refresh em cookie HttpOnly)
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<boolean> | null = null;

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/** Registra um listener acionado quando a sessão expira de vez (refresh falhou). */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

const REFRESH_MARGIN_MS = 90_000;
const REFRESH_FALLBACK_MS = 10 * 60_000;

function isAuthPath(path: string): boolean {
  return path === "/auth/login" || path === "/auth/refresh" || path === "/auth/logout";
}

function decodeJwtExpiry(token: string): number | null {
  const payloadPart = token.split(".")[1];
  if (!payloadPart) return null;
  try {
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function clearRefreshTimer(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** Agenda o refresh silencioso com margem antes da expiração real. */
function scheduleProactiveRefresh(): void {
  clearRefreshTimer();
  const expiry = accessToken !== null ? decodeJwtExpiry(accessToken) : null;
  if (expiry === null) {
    refreshTimer = setTimeout(() => void refreshNow(), REFRESH_FALLBACK_MS);
    return;
  }
  const delay = expiry - Date.now() - REFRESH_MARGIN_MS;
  if (delay <= 0) {
    void refreshNow();
    return;
  }
  refreshTimer = setTimeout(() => void refreshNow(), delay);
}

/** Rotaciona os tokens via cookie; single-flight contra refreshes concorrentes. */
async function refreshNow(): Promise<boolean> {
  if (refreshInFlight !== null) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const result = await rawRequest<Schemas["RefreshOut"]>("POST", "/auth/refresh");
      accessToken = result.access_token;
      scheduleProactiveRefresh();
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Sessão expirada de vez: logout limpo no servidor + aviso aos listeners. */
async function expireSession(): Promise<void> {
  accessToken = null;
  clearRefreshTimer();
  try {
    await rawRequest("POST", "/auth/logout");
  } catch {
    /* a sessão pode já estar revogada — logout é best-effort */
  }
  for (const listener of sessionExpiredListeners) listener();
}

/**
 * Boot da autenticação: tenta um refresh silencioso (o cookie HttpOnly decide
 * se havia sessão). Retorna false quando não há sessão válida — a UI mostra o
 * login. "sessionExpired" só é emitido quando a sessão quebrou DURANTE o uso.
 */
export async function initAuth(): Promise<boolean> {
  const refreshed = await refreshNow();
  if (!refreshed) {
    accessToken = null;
    clearRefreshTimer();
    return false;
  }
  return true;
}

/** Registra o access token de um login bem-sucedido e agenda o refresh. */
export function setAccessToken(token: string): void {
  accessToken = token;
  scheduleProactiveRefresh();
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Logout explícito do usuário: limpa tudo SEM emitir sessionExpired. */
export async function clear(): Promise<void> {
  accessToken = null;
  clearRefreshTimer();
  try {
    await rawRequest("POST", "/auth/logout");
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Núcleo de requisição
// ---------------------------------------------------------------------------

function isApiErrorBody(value: unknown): value is { error?: { code?: unknown; message?: unknown } } {
  return typeof value === "object" && value !== null && "error" in value;
}

function parseBodyText(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function buildHeaders(options: RequestInit, withAuth: boolean): Promise<Headers> {
  const headers = new Headers(options.headers);
  if (withAuth && accessToken !== null) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body !== undefined && options.body !== null && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = body === undefined ? { method } : { method, body: JSON.stringify(body) };
  const headers = await buildHeaders(init, false);
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = parseBodyText(text);
  if (!response.ok) {
    if (isApiErrorBody(data) && data.error !== undefined) {
      const code = typeof data.error.code === "string" ? data.error.code : "unknown";
      const message = typeof data.error.message === "string" ? data.error.message : "request_failed";
      throw new ApiError(response.status, code, message);
    }
    throw new ApiError(response.status, "unknown", "request_failed");
  }
  // Único cast de fronteira do módulo: o JSON não validável é entregue ao
  // chamador já tipado pelo contrato OpenAPI (types/api.ts).
  return data as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await buildHeaders(options, true);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });

  if (response.status === 401 && !isAuthPath(path)) {
    const refreshed = await refreshNow();
    if (refreshed) {
      return requestInner<T>(path, options);
    }
    await expireSession();
    throw new ApiError(401, "session_expired", "session_expired");
  }
  return finishResponse<T>(response);
}

async function requestInner<T>(path: string, options: RequestInit): Promise<T> {
  const headers = await buildHeaders(options, true);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) {
    await expireSession();
    throw new ApiError(401, "session_expired", "session_expired");
  }
  return finishResponse<T>(response);
}

async function finishResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = parseBodyText(text);
  if (!response.ok) {
    if (isApiErrorBody(data) && data.error !== undefined) {
      const code = typeof data.error.code === "string" ? data.error.code : "unknown";
      const message = typeof data.error.message === "string" ? data.error.message : "request_failed";
      throw new ApiError(response.status, code, message);
    }
    throw new ApiError(response.status, "unknown", "request_failed");
  }
  // Cast de fronteira idem rawRequest — tipado pelo contrato OpenAPI.
  return data as T;
}

/** API genérica (compatível com os consumidores atuais da UI). */
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Upload/download via XHR (progresso + abort)
// ---------------------------------------------------------------------------

function applyXhrHeaders(xhr: XMLHttpRequest): void {
  if (accessToken !== null) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
}

export interface UploadOptions {
  onProgress?: (progress: ProgressInfo) => void;
  signal?: AbortSignal;
}

/** Upload multipart com progresso real (fetch não expõe upload.onprogress). */
export async function apiUploadFile<T>(
  path: string,
  form: FormData,
  options: UploadOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    applyXhrHeaders(xhr);
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (options.onProgress !== undefined && event.lengthComputable) {
        options.onProgress({ loaded: event.loaded, total: event.total });
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "network_error"));
    xhr.onabort = () => reject(new DOMException("upload_aborted", "AbortError"));
    xhr.onload = () => {
      if (xhr.status === 401) {
        void (async () => {
          const refreshed = await refreshNow();
          if (refreshed) {
            try {
              resolve(await apiUploadFile<T>(path, form, options));
            } catch (error) {
              reject(error);
            }
          } else {
            await expireSession();
            reject(new ApiError(401, "session_expired", "session_expired"));
          }
        })();
        return;
      }
      const data = parseBodyText(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T); // fronteira JSON → tipo OpenAPI
        return;
      }
      if (isApiErrorBody(data) && data.error !== undefined) {
        const code = typeof data.error.code === "string" ? data.error.code : "unknown";
        const message = typeof data.error.message === "string" ? data.error.message : "upload_failed";
        reject(new ApiError(xhr.status, code, message));
        return;
      }
      reject(new ApiError(xhr.status, "unknown", "upload_failed"));
    };

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        reject(new DOMException("upload_aborted", "AbortError"));
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}

export interface DownloadOptions {
  onProgress?: (progress: ProgressInfo) => void;
}

/**
 * Download autenticado com progresso; devolve os bytes brutos para o chamador
 * conferir o SHA-256 antes de salvar (ver lib/files.ts).
 */
export async function apiDownloadFile(
  path: string,
  options: DownloadOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path);
    xhr.withCredentials = true;
    applyXhrHeaders(xhr);
    xhr.responseType = "arraybuffer";

    xhr.onprogress = (event) => {
      if (options.onProgress !== undefined && event.lengthComputable) {
        options.onProgress({ loaded: event.loaded, total: event.total });
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "network_error"));
    xhr.onload = () => {
      if (xhr.status === 401) {
        void (async () => {
          const refreshed = await refreshNow();
          if (refreshed) {
            try {
              resolve(await apiDownloadFile(path, options));
            } catch (error) {
              reject(error);
            }
          } else {
            await expireSession();
            reject(new ApiError(401, "session_expired", "session_expired"));
          }
        })();
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(new Uint8Array<ArrayBuffer>(xhr.response));
        return;
      }
      const text = typeof xhr.response === "string" ? xhr.response : "";
      const data = parseBodyText(text);
      if (isApiErrorBody(data) && data.error !== undefined) {
        const code = typeof data.error.code === "string" ? data.error.code : "unknown";
        const message = typeof data.error.message === "string" ? data.error.message : "download_failed";
        reject(new ApiError(xhr.status, code, message));
        return;
      }
      reject(new ApiError(xhr.status, "unknown", "download_failed"));
    };
    xhr.send();
  });
}

// ---------------------------------------------------------------------------
// Endpoints tipados (schemas do OpenAPI + normalização no limite)
// ---------------------------------------------------------------------------

function normalizeDirectoryUser(raw: Schemas["DirectoryUserOut"]): DirectoryUser {
  return { ...raw, role: parseRole(raw.role), presence: parsePresence(raw.presence) ?? "offline" };
}

function normalizeUser(raw: Schemas["UserOut"]): User {
  return { ...raw, role: parseRole(raw.role) };
}

function normalizeConversation(raw: Schemas["ConversationOut"]): Conversation {
  return { ...raw, kind: parseConversationKind(raw.kind) };
}

function normalizeSummary(raw: Schemas["ConversationSummaryOut"]): ConversationSummary {
  return { ...raw, conversation: normalizeConversation(raw.conversation) };
}

export interface WsTicket {
  ticket: string;
  expires_in: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWsTicket(value: unknown): WsTicket {
  if (isRecord(value) && typeof value.ticket === "string") {
    return {
      ticket: value.ticket,
      expires_in: typeof value.expires_in === "number" ? value.expires_in : 30,
    };
  }
  throw new ApiError(0, "invalid_ticket", "invalid_ws_ticket");
}

export const endpoints = {
  login: async (body: Schemas["LoginIn"]): Promise<Schemas["LoginOut"] & { user: User }> => {
    const raw = await request<Schemas["LoginOut"]>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { ...raw, user: normalizeUser(raw.user) };
  },
  me: async (): Promise<User> => normalizeUser(await request<Schemas["UserOut"]>("/me")),
  health: () => request<Schemas["HealthOut"]>("/health"),
  listDirectoryUsers: async (): Promise<DirectoryUser[]> => {
    const raw = await request<Schemas["DirectoryUserOut"][]>("/users");
    return raw.map(normalizeDirectoryUser);
  },
  listConversations: async (): Promise<ConversationSummary[]> => {
    const raw = await request<Schemas["ConversationSummaryOut"][]>("/conversations");
    return raw.map(normalizeSummary);
  },
  openDm: async (userId: string): Promise<Conversation> => {
    const raw = await request<Schemas["ConversationOut"]>("/conversations/dm", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
    return normalizeConversation(raw);
  },
  listMessages: (
    conversationId: string,
    params: { beforeSeq?: number; afterSeq?: number; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.beforeSeq !== undefined) query.set("before_seq", String(params.beforeSeq));
    if (params.afterSeq !== undefined) query.set("after_seq", String(params.afterSeq));
    query.set("limit", String(params.limit ?? 50));
    return request<Schemas["MessageOut"][]>(
      `/conversations/${conversationId}/messages?${query.toString()}`,
    );
  },
  markRead: (conversationId: string, lastReadSeq: number) =>
    request<void>(`/conversations/${conversationId}/read`, {
      method: "POST",
      body: JSON.stringify({ last_read_seq: lastReadSeq }),
    }),
  sendMessage: (body: Schemas["SendMessageIn"]) =>
    request<Schemas["MessageOut"]>("/messages", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  editMessage: (messageId: string, body: string) =>
    request<Schemas["MessageOut"]>(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),
  deleteMessage: (messageId: string) =>
    request<void>(`/messages/${messageId}`, { method: "DELETE" }),
  searchMessages: (query: string) =>
    request<Schemas["MessageOut"][]>(`/search?q=${encodeURIComponent(query)}`),
  listMessageAttachments: (messageId: string) =>
    request<Schemas["AttachmentOut"][]>(`/messages/${messageId}/attachments`),
  getWsTicket: async (): Promise<WsTicket> => {
    const raw = await request<Record<string, unknown>>("/ws/ticket", { method: "POST" });
    return parseWsTicket(raw);
  },
};

export type { Message, User };
