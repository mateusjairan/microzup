/**
 * Fachada de tipos do renderer.
 *
 * Os tipos de API vêm de `types/api.ts` (gerado do OpenAPI — regra do repo:
 * nenhum tipo de API escrito à mão). Este módulo apenas:
 *  1. re-exporta os schemas gerados sob os nomes históricos que a UI consome;
 *  2. adiciona os estreitamentos com normalização em runtime no limite da API
 *     (parsePresence/parseRole/parseKind — ver types/client.ts);
 *  3. re-exporta os tipos de domínio local (ChatMessage, OutboxEntry, …).
 */
export type {
  Role,
  PresenceStatus,
  ConnectionState,
  LocalMessageState,
  ChatMessage,
  StatusMessage,
  NudgeEvent,
  OutboxEntry,
  MessageCreatedPayload,
} from "./types/client";
export {
  parsePresence,
  parseRole,
  parseConversationKind,
} from "./types/client";

export type {
  WsEnvelope,
  HelloPayload,
  HelloUser,
  PresenceChangedPayload,
  TypingPayload,
  ReadUpdatedPayload,
  MessageDeletedPayload,
  NudgePayload,
  NudgeRefusedPayload,
  AttachmentReadyPayload,
  WsErrorPayload,
  ClientWsMessage,
  PresenceValue,
  ApiMessage,
} from "./types/ws";

export type {
  AppPreferences,
  StoredTokens,
  MessageNotificationRequest,
  NudgeNotificationRequest,
} from "../electron/ipc-contract";

import type { components } from "./types/api";
import type { PresenceStatus, Role } from "./types/client";
import type { StoredTokens } from "../electron/ipc-contract";

type Schemas = components["schemas"];

export type User = Schemas["UserOut"] & { presence?: PresenceStatus; role: Role };

export type DirectoryUser = Schemas["UserOut"] & { presence: PresenceStatus; role: Role };

export type Conversation = Omit<Schemas["ConversationOut"], "kind"> & {
  kind: "channel" | "dm";
};

export type ConversationSummary = Omit<Schemas["ConversationSummaryOut"], "conversation"> & {
  conversation: Conversation;
};

export type Message = Schemas["MessageOut"];
export type Attachment = Schemas["AttachmentOut"];
export type Sector = Schemas["SectorOut"];
export type AuditEntry = Schemas["AuditOut"];
export type AdminStats = Schemas["StatsOut"];
export type LoginResponse = Schemas["LoginOut"];

/** Par de tokens em memória/seguro — formato do cliente, não da API. */
export type Tokens = StoredTokens;
