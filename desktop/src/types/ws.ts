/**
 * Tipos do protocolo WebSocket (plano-mvp §6).
 *
 * O envelope S→C é `{type, seq, ts, payload}`. Os payloads abaixo descrevem o
 * que o servidor emite hoje (server/app/presentation/ws/hub.py e api/ws.py).
 * Mensagens C→S são achatadas (`{type, conversation_id, ...}`) porque é assim
 * que o handler atual do servidor lê o JSON — ver `_handle_client_message`.
 */
import type { components } from "./api";

export type ApiMessage = components["schemas"]["MessageOut"];

export interface WsEnvelope<P = Record<string, unknown>> {
  type: string;
  seq: number;
  ts: string;
  payload: P;
}

export interface HelloUser {
  id: string;
  username: string;
  display_name: string;
}

export interface HelloPayload {
  version: string;
  user: HelloUser;
  /** Conversas das quais o usuário é membro (inscrições). */
  subscriptions: string[];
  /** Snapshot de presença por user_id. */
  presence: Record<string, string>;
  /** Recados de status ativos por user_id (plano-frontend §3). */
  status_messages: Record<string, string>;
}

export interface MessageCreatedPayload extends ApiMessage {
  /** Anexo(s) vinculados — presente apenas no evento WS, não no REST. */
  attachment_ids?: string[];
}

export interface MessageDeletedPayload {
  conversation_id: string;
  message_id: string;
}

export interface PresenceChangedPayload {
  user_id: string;
  status: string;
  /**
   * Recado de status do usuário. O hub inclui o campo APENAS quando existe
   * recado ativo — ausência significa "sem recado agora" (o payload é
   * reconstruído do estado do hub em cada broadcast).
   */
  status_message?: string;
}

export interface TypingPayload {
  conversation_id: string;
  user_id: string;
  is_typing: boolean;
}

export interface ReadUpdatedPayload {
  conversation_id: string;
  user_id: string;
  last_read_seq: number;
}

/** "Chamar atenção" recebido — o servidor já resolve o nome do remetente. */
export interface NudgePayload {
  conversation_id: string;
  sender_id: string;
  sender_name: string;
}

/** Nudge recusado pelo servidor (throttle/permissão/ausência do alvo). */
export interface NudgeRefusedPayload {
  conversation_id: string;
  reason: string;
}

export interface AttachmentReadyPayload {
  attachment_id: string;
  has_thumbnail: boolean;
}

/** Erro de validação enviado pelo servidor (ex.: recado > 120 chars). */
export interface WsErrorPayload {
  code: string;
  message: string;
}

export type PresenceValue = "available" | "busy" | "away" | "dnd" | "invisible";

/**
 * Mensagens enviadas pelo cliente — formato achatado, como o servidor lê.
 * `presence.set.status_message`: texto não-vazio define o recado; string
 * vazia LIMPA; omitido MANTÉM o recado atual do servidor.
 */
export type ClientWsMessage =
  | { type: "ping" }
  | { type: "presence.set"; status: PresenceValue; status_message?: string }
  | { type: "typing"; conversation_id: string; is_typing: boolean }
  | { type: "nudge"; conversation_id: string };
