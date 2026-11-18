/**
 * Cliente HTTP do Microzup.
 *
 * - Access token vive só em memória; o refresh token persiste via bridge
 *   (safeStorage/DPAPI no Electron — nunca localStorage em produção).
 * - Refresh proativo: chama /auth/refresh ANTES do access expirar (margem de
 *   segurança de 90 s) e refaz o agendamento a cada rotação.
 * - 401 em chamada autenticada → um único refresh + retry da chamada original.
 * - Refresh definitivamente inválido → estado "sessionExpired" (listeners) e
 *   logout limpo no servidor (best-effort). O composer/rascunho NÃO é destruído.
 * - Upload/download via XMLHttpRequest porque fetch não expõe progresso.
 *
 * Tipos de resposta vêm do OpenAPI gerado (types/api.ts).
 */
import type { components } from "../types/api";
import type { StoredTokens } from "../../electron/ipc-contract";
import type { Conversation, ConversationSummary, DirectoryUser, Message, User } from "../types";
import { parseConversationKind, parsePresence, parseRole } from "../types/client";
import {
  clearTokens,
  getServerUrl,
  loadTokens,
  onTokensCleared,
  saveTokens as persistTokens,
} from "./bridge";

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
// Estado de sessão (access em memória; refresh persistido via bridge)
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<boolean> | null = null;
/**
 * "Manter conectado" DESMARCADO: o refresh token vive só em memória — nada é
 * (re)gravado em disco. Vira true quando os tokens são apagados do disco logo
 * após o login (Login chama bridge.clearTokens) ou quando setTokens recebe
 * { sessionOnly: true }; um novo login com persistência reseta para false.
 */
let sessionOnly = false;

/** true quando a sessão atual NÃO persiste o refresh token em disco. */
export function isSessionOnly(): boolean {
  return sessionOnly;
}

// Apagar os tokens do disco após o login = intenção de sessão única.
onTokensCleared(() => {
  sessionOnly = true;
});

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

/** Rotaciona os tokens; single-flight para não disparar refreshes concorrentes. */
async function refreshNow(): Promise<boolean> {
  if (refreshToken === null) return false;
  if (refreshInFlight !== null) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const result = await rawRequest<Schemas["RefreshOut"]>("POST", "/auth/refresh", {
        refresh_token: refreshToken,
      });
      accessToken = result.access_token;
      refreshToken = result.refresh_token;
      if (!sessionOnly) {
        await persistTokens({ access: accessToken, refresh: refreshToken });
      }
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
  const refresh = refreshToken;
  accessToken = null;
  refreshToken = null;
  clearRefreshTimer();
  await clearTokens();
  if (refresh !== null) {
    try {
      await rawRequest("POST", "/auth/logout", { refresh_token: refresh });
    } catch {
      /* a sessão pode já estar revogada — logout é best-effort */
    }
  }
  for (const listener of sessionExpiredListeners) listener();
}

/**
 * Boot da autenticação: carrega tokens persistidos e faz um refresh imediato
 * (rotaciona o access antes de qualquer chamada). Retorna false quando não há
 * sessão válida — a UI mostra o login. O estado "sessionExpired" só é emitido
 * quando a sessão existia e quebrou DURANTE o uso (não no boot).
 */
export async function initAuth(): Promise<boolean> {
  const stored = await loadTokens();
  if (stored === null || typeof stored.refresh !== "string" || stored.refresh === "") {
    if (stored !== null) await clearTokens();
    return false;
  }
  accessToken = stored.access;
  refreshToken = stored.refresh;
  const refreshed = await refreshNow();
  if (!refreshed) {
    await clearTokens();
    accessToken = null;
    refreshToken = null;
    return false;
  }
  return true;
}

/**
 * Persiste tokens de um login bem-sucedido e agenda o refresh proativo.
 *
 * `sessionOnly: true` = "manter conectado" desmarcado: o refresh token fica
 * APENAS em memória (nada é gravado em disco; rotações futuras tampouco).
 * O default (`sessionOnly: false`) reseta o modo — um login comum persiste.
 */
export async function setTokens(
  tokens: StoredTokens,
  options: { sessionOnly?: boolean } = {},
): Promise<void> {
  accessToken = tokens.access;
  refreshToken = tokens.refresh;
  sessionOnly = options.sessionOnly === true;
  if (!sessionOnly) {
    await persistTokens(tokens);
  }
  scheduleProactiveRefresh();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/** Logout explícito do usuário: limpa tudo SEM emitir sessionExpired. */
export async function clear(): Promise<void> {
  const refresh = refreshToken;
  accessToken = null;
  refreshToken = null;
  clearRefreshTimer();
  await clearTokens();
  // clearTokens acima sinaliza "sessão única" ao listener; um logout explícito
  // encerra a sessão — o próximo login decide novamente como persistir.
  sessionOnly = false;
  if (refresh !== null) {
    try {
      await rawRequest("POST", "/auth/logout", { refresh_token: refresh });
    } catch {
      /* best-effort */
    }
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
  const base = await getServerUrl();
  const init: RequestInit = body === undefined ? { method } : { method, body: JSON.stringify(body) };
  const headers = await buildHeaders(init, false);
  const response = await fetch(`${base}${path}`, { ...init, headers });
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
  const base = await getServerUrl();
  const headers = await buildHeaders(options, true);
  const response = await fetch(`${base}${path}`, { ...options, headers });

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
  const base = await getServerUrl();
  const headers = await buildHeaders(options, true);
  const response = await fetch(`${base}${path}`, { ...options, headers });
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
  const base = await getServerUrl();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}${path}`);
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
  const base = await getServerUrl();
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${base}${path}`);
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
