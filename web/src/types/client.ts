/**
 * Tipos de domínio do cliente (não são tipos de API — esses vêm de types/api.ts,
 * gerado do OpenAPI). Aqui ficam: estados locais de mensagem, outbox, conexão,
 * presença e os estreitamentos de runtime (parsePresence/parseRole/parseKind).
 */
import type { components } from "./api";
import type { OutboxEntry } from "../lib/platform";
import type { MessageCreatedPayload, PresenceValue } from "./ws";

export type Schemas = components["schemas"];

/** Papel do usuário — o OpenAPI expõe `string`; o cliente estreita no limite. */
export type Role = "admin" | "member";

/** Presença incluindo o estado sintético "offline" (ausência de conexão). */
export type PresenceStatus = PresenceValue | "offline";

export type ConnectionState =
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline"
  | "sessionExpired";

/** Estado local de uma mensagem otimista (envio ainda não confirmado). */
export interface LocalMessageState {
  status: "sending" | "failed";
  queuedAt: number;
  errorKey?: string;
}

/** Mensagem do chat: REST/WS + estado de envio otimista. */
export type ChatMessage = Schemas["MessageOut"] & { local?: LocalMessageState };

export type { OutboxEntry };

/** Recado de status — 120 caracteres, expira em 8 h (plano-frontend §3). */
export interface StatusMessage {
  text: string;
  /** epoch ms de expiração. */
  expiresAt: number;
}

export interface NudgeEvent {
  conversationId: string;
  fromUserId: string;
  at: number;
}

export type { MessageCreatedPayload };

/** Presença escolhível pelo usuário (sem o sintético "offline"). */
export type { PresenceValue } from "./ws";

export function parsePresence(value: unknown): PresenceStatus | null {
  switch (value) {
    case "available":
    case "busy":
    case "away":
    case "dnd":
    case "invisible":
    case "offline":
      return value;
    default:
      return null;
  }
}

export function parseRole(value: unknown): Role {
  return value === "admin" ? "admin" : "member";
}

export function parseConversationKind(value: unknown): "channel" | "dm" {
  return value === "dm" ? "dm" : "channel";
}
