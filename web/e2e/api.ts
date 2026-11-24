/**
 * Cliente REST da suíte (Node fetch) — usado para bootstrap de fixtures e para
 * o "segundo usuário" nas specs de interação (docs/api.md).
 *
 * Envelope de erro: {"error": {"code", "message", "details"}}.
 */
import { randomUUID } from "node:crypto";

import { BASE_URL } from "./constants";

export interface LoginResult {
  access_token: string;
  user: { id: string; username: string; display_name: string; role: string };
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`HTTP ${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

const tokens = new Map<string, string>();

/** Login REST com cache do access token (TTL 15 min — sobra para a suíte). */
export async function apiLogin(username: string, password: string): Promise<LoginResult> {
  const attempt = async (): Promise<Response> =>
    fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, device_name: "e2e-suite" }),
    });

  let response = await attempt();
  if (response.status === 429) {
    // Login tem rate limit de 10/min POR IP; bursts (worker reiniciando um
    // beforeAll, por ex.) esperam a janela de 60s rolarem em vez de falhar.
    await new Promise((resolve) => setTimeout(resolve, 65_000));
    response = await attempt();
  }

  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; user?: LoginResult["user"]; error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const code = body?.error?.code ?? "unknown";
    const message = body?.error?.message ?? response.statusText;
    throw new ApiHttpError(response.status, code, message);
  }
  if (typeof body?.access_token !== "string" || body.user === undefined) {
    throw new Error(`E2E: resposta de login inesperada para ${username}`);
  }
  tokens.set(username, body.access_token);
  return { access_token: body.access_token, user: body.user };
}

/** Token em cache (login já feito nesta instância) ou novo login. */
export async function apiToken(username: string, password: string): Promise<string> {
  const cached = tokens.get(username);
  if (cached !== undefined) return cached;
  return (await apiLogin(username, password)).access_token;
}

export async function apiGet<T>(token: string, pathname: string): Promise<T> {
  return request<T>(token, "GET", pathname);
}

export async function apiPost<T>(token: string, pathname: string, body?: unknown): Promise<T> {
  return request<T>(token, "POST", pathname, body);
}

async function request<T>(token: string, method: string, pathname: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const envelope = parsed as { error?: { code?: string; message?: string } } | null;
    const code = envelope?.error?.code ?? "unknown";
    const message = envelope?.error?.message ?? response.statusText;
    throw new ApiHttpError(response.status, code, message);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Endpoints usados pelas specs
// ---------------------------------------------------------------------------

export interface ConversationOut {
  conversation: {
    id: string;
    kind: "channel" | "dm";
    name: string | null;
    peer_id: string | null;
  };
  unread_count: number;
  last_message: { seq: number; body: string } | null;
}

export async function listConversations(token: string): Promise<ConversationOut[]> {
  return apiGet<ConversationOut[]>(token, "/conversations");
}

/** Id do canal por nome, ou da DM pelo display name do par. */
export async function findConversation(
  token: string,
  match: { channelName?: string; peerDisplayName?: string },
): Promise<ConversationOut> {
  const conversations = await listConversations(token);
  const found = conversations.find((summary) => {
    if (match.channelName !== undefined) {
      return summary.conversation.kind === "channel" && summary.conversation.name === match.channelName;
    }
    return summary.conversation.kind === "dm" && summary.conversation.peer_id !== null;
  });
  if (found === undefined) throw new Error(`E2E: conversa não encontrada (${JSON.stringify(match)})`);
  return found;
}

export interface MessageOut {
  id: string;
  seq: number;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  body: string;
  created_at: string;
}

/**
 * Histórico por cursor `seq` (docs/api.md §3.5). SEM cursor o servidor devolve
 * a página MAIS ANTIGA — para verificação de mensagens recentes usamos
 * before_seq alto (= janela mais recente, ordem cronológica).
 */
export async function listMessages(
  token: string,
  conversationId: string,
  params: { limit?: number; afterSeq?: number } = {},
): Promise<MessageOut[]> {
  const query = new URLSearchParams({ limit: String(params.limit ?? 200) });
  if (params.afterSeq !== undefined) {
    query.set("after_seq", String(params.afterSeq));
  } else {
    query.set("before_seq", String(Number.MAX_SAFE_INTEGER));
  }
  return apiGet<MessageOut[]>(token, `/conversations/${conversationId}/messages?${query.toString()}`);
}

/** Envia como usuário (idempotente por client_id gerado aqui). */
export async function sendMessageAs(
  username: string,
  password: string,
  conversationId: string,
  body: string,
): Promise<MessageOut> {
  const token = await apiToken(username, password);
  return apiPost<MessageOut>(token, "/messages", {
    conversation_id: conversationId,
    client_id: randomUUID(),
    body,
  });
}

/** Abre (ou reaproveita) a DM com o par. */
export async function openDm(token: string, peerUserId: string): Promise<{ id: string }> {
  return apiPost<{ id: string }>(token, "/conversations/dm", { user_id: peerUserId });
}

export interface UserOut {
  id: string;
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

export async function listUsers(token: string, includeInactive = true): Promise<UserOut[]> {
  return apiGet<UserOut[]>(token, `/admin/users${includeInactive ? "?include_inactive=true" : ""}`);
}

export async function listSectors(token: string): Promise<Array<{ id: string; name: string }>> {
  return apiGet<Array<{ id: string; name: string }>>(token, "/admin/sectors");
}

export async function markRead(token: string, conversationId: string, lastReadSeq: number): Promise<void> {
  await apiPost<void>(token, `/conversations/${conversationId}/read`, { last_read_seq: lastReadSeq });
}
