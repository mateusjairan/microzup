/**
 * Store Zustand — fonte única de verdade do cliente (plano-frontend §12).
 *
 * Estado normalizado:
 *  - `messagesByConversation`: mensagens por conversa, ordenadas por `seq`
 *    (ordem canônica); mensagens otimistas ficam ao fim, ordenadas por fila.
 *  - `users`/`conversations`/`presence`: coleções de entidades.
 *  - `lastSeqByConversation`: cursor de catch-up por `seq`.
 *  - `outbox`: fila de envio persistida em disco (idempotente por client_id).
 *  - `drafts`: rascunhos do composer — PRESERVADOS em logout/sessão expirada.
 *
 * O envio otimista é `sending → sent → failed`; o retry reutiliza o MESMO
 * client_id. Eventos WS mutam o store via lib/realtime.ts.
 */
import { create } from "zustand";
import { ApiError, endpoints } from "../lib/api";
import { newClientId } from "../lib/crypto";
import { clearOutbox, persistOutbox } from "../lib/outbox";
import { setPreferences } from "../lib/bridge";
import type {
  ChatMessage,
  ConnectionState,
  MessageCreatedPayload,
  NudgeEvent,
  OutboxEntry,
  PresenceStatus,
  Schemas,
  StatusMessage,
} from "../types/client";
import type { ConversationSummary, User } from "../types";

export const STATUS_MESSAGE_MAX_CHARS = 120;
export const STATUS_MESSAGE_TTL_MS = 8 * 60 * 60 * 1000;

/** Mantém as mensagens ordenadas: confirmadas por seq; locais no fim (fila). */
function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => {
    const aLocal = a.local !== undefined;
    const bLocal = b.local !== undefined;
    if (aLocal !== bLocal) return aLocal ? 1 : -1;
    if (aLocal && bLocal && a.local !== undefined && b.local !== undefined) {
      return a.local.queuedAt - b.local.queuedAt;
    }
    return a.seq - b.seq;
  });
}

/** Substitui a mensagem otimista com o mesmo client_id (reconciliação). */
function reconcileIntoList(list: ChatMessage[], incoming: Schemas["MessageOut"]): ChatMessage[] {
  const index = list.findIndex(
    (m) => m.client_id === incoming.client_id || m.id === incoming.id,
  );
  if (index === -1) return sortMessages([...list, incoming]);
  const next = [...list];
  next[index] = incoming;
  return sortMessages(next);
}

function maxSeqOf(list: ChatMessage[], current: number): number {
  return list.reduce((max, m) => (m.local === undefined && m.seq > max ? m.seq : max), current);
}

function withLocalStatus(
  list: ChatMessage[],
  clientId: string,
  status: "sending" | "failed",
  errorKey?: string,
): ChatMessage[] {
  return list.map((m) =>
    m.client_id === clientId && m.local !== undefined
      ? { ...m, local: { ...m.local, status, errorKey } }
      : m,
  );
}

function optimisticMessage(entry: OutboxEntry, senderId: string): ChatMessage {
  return {
    id: `local:${entry.clientId}`,
    seq: 0,
    conversation_id: entry.conversationId,
    sender_id: senderId,
    client_id: entry.clientId,
    body: entry.body,
    created_at: new Date(entry.queuedAt).toISOString(),
    edited_at: null,
    deleted_at: null,
    local: { status: "sending", queuedAt: entry.queuedAt },
  };
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
  attachmentIds?: string[];
}

export interface AppState {
  // Entidades
  user: User | null;
  users: User[];
  conversations: ConversationSummary[];
  messagesByConversation: Record<string, ChatMessage[]>;
  presence: Record<string, PresenceStatus>;
  /** Recado de status ATIVO por user_id ( snapshot do hello + presence.changed). */
  statusNotes: Record<string, string>;
  typing: Record<string, string[]>;
  lastReadByUser: Record<string, Record<string, number>>;

  // Cursores e sessão
  lastSeqByConversation: Record<string, number>;
  activeConversationId: string | null;
  drafts: Record<string, string>;
  connection: ConnectionState;
  reconnectAttempt: number;
  connected: boolean;
  sessionExpired: boolean;
  sessionLocked: boolean;
  windowFocused: boolean;

  // Presença própria
  myStatus: PresenceStatus;
  autoAway: boolean;
  previousStatus: PresenceStatus | null;
  statusMessage: StatusMessage | null;

  // Fila de envio persistida
  outbox: OutboxEntry[];

  // Versões (banner "nova versão")
  serverVersion: string | null;
  lastServerVersion: string | null;
  serverVersionNotice: boolean;
  appVersion: string | null;

  // Notificações/silêncio
  mutedConversations: string[];
  lastNudge: NudgeEvent | null;

  // ---- Ações (compat com a UI atual) ----
  setUser: (user: User | null) => void;
  setUsers: (users: User[]) => void;
  setConversations: (conversations: ConversationSummary[]) => void;
  setMessages: (conversationId: string, messages: Schemas["MessageOut"][]) => void;
  addMessage: (message: Schemas["MessageOut"]) => void;
  updateMessage: (message: Schemas["MessageOut"]) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  setPresence: (userId: string, status: PresenceStatus) => void;
  /** Recado de status de um par: texto ativo ou null para limpar. */
  setStatusNote: (userId: string, note: string | null) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
  setActiveConversation: (conversationId: string | null) => void;
  setMyStatus: (status: PresenceStatus) => void;
  setConnected: (connected: boolean) => void;
  markRead: (conversationId: string) => void;
  reset: () => void;

  // ---- Ações novas (camada de estado/conexão) ----
  setDraft: (conversationId: string, text: string) => void;
  setConnection: (connection: ConnectionState, attempt: number) => void;
  setSessionExpired: (expired: boolean) => void;
  setSessionLocked: (locked: boolean) => void;
  setWindowFocused: (focused: boolean) => void;
  appendMessages: (conversationId: string, messages: Schemas["MessageOut"][]) => void;
  applyIncomingMessage: (message: MessageCreatedPayload) => void;
  setLastRead: (conversationId: string, userId: string, lastReadSeq: number) => void;
  setStatusMessage: (text: string | null) => void;
  expireStatusMessage: () => void;
  setAutoAway: (away: boolean) => void;
  restoreFromAutoAway: () => void;
  hydrateOutbox: (entries: OutboxEntry[]) => void;
  sendMessage: (input: SendMessageInput) => void;
  retryMessage: (clientId: string) => void;
  dismissFailedMessage: (clientId: string) => void;
  flushOutbox: () => Promise<void>;
  setLastNudge: (event: NudgeEvent | null) => void;
  applyServerVersion: (version: string) => void;
  ackServerVersion: () => void;
  setAppVersion: (version: string) => void;
  setLastServerVersion: (version: string | null) => void;
  setMutedConversations: (conversationIds: string[]) => void;
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  users: [],
  conversations: [],
  messagesByConversation: {},
  presence: {},
  statusNotes: {},
  typing: {},
  lastReadByUser: {},

  lastSeqByConversation: {},
  activeConversationId: null,
  drafts: {},
  connection: "connecting",
  reconnectAttempt: 0,
  connected: false,
  sessionExpired: false,
  sessionLocked: false,
  windowFocused: typeof document !== "undefined" ? document.hasFocus() : true,

  myStatus: "available",
  autoAway: false,
  previousStatus: null,
  statusMessage: null,

  outbox: [],

  serverVersion: null,
  lastServerVersion: null,
  serverVersionNotice: false,
  appVersion: null,

  mutedConversations: [],
  lastNudge: null,

  // -----------------------------------------------------------------------
  // Ações de compatibilidade (assinaturas preservadas para a UI atual)
  // -----------------------------------------------------------------------

  setUser: (user) => set({ user }),

  setUsers: (users) => set({ users }),

  setConversations: (conversations) => set({ conversations }),

  setMessages: (conversationId, messages) =>
    set((state) => {
      const list = sortMessages(messages);
      return {
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: list },
        lastSeqByConversation: {
          ...state.lastSeqByConversation,
          [conversationId]: maxSeqOf(list, state.lastSeqByConversation[conversationId] ?? 0),
        },
      };
    }),

  addMessage: (message) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [message.conversation_id]: reconcileIntoList(
          state.messagesByConversation[message.conversation_id] ?? [],
          message,
        ),
      },
      lastSeqByConversation: {
        ...state.lastSeqByConversation,
        [message.conversation_id]: Math.max(
          message.seq,
          state.lastSeqByConversation[message.conversation_id] ?? 0,
        ),
      },
    })),

  updateMessage: (message) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [message.conversation_id]: reconcileIntoList(
          state.messagesByConversation[message.conversation_id] ?? [],
          message,
        ),
      },
    })),

  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((m) =>
          m.id === messageId
            ? { ...m, body: "Mensagem removida", deleted_at: new Date().toISOString() }
            : m,
        ),
      },
    })),

  setPresence: (userId, status) =>
    set((state) => ({ presence: { ...state.presence, [userId]: status } })),

  setStatusNote: (userId, note) =>
    set((state) => {
      if (note === null || note === "") {
        if (!(userId in state.statusNotes)) return {};
        const next = { ...state.statusNotes };
        delete next[userId];
        return { statusNotes: next };
      }
      return { statusNotes: { ...state.statusNotes, [userId]: note } };
    }),

  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const current = state.typing[conversationId] ?? [];
      const next = isTyping
        ? Array.from(new Set([...current, userId]))
        : current.filter((id) => id !== userId);
      return { typing: { ...state.typing, [conversationId]: next } };
    }),

  setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),

  setMyStatus: (status) =>
    set((state) => ({
      myStatus: status,
      autoAway: state.autoAway && status === "away" ? state.autoAway : false,
    })),

  setConnected: (connected) =>
    set((state) => ({
      connected,
      connection: connected ? "online" : state.connection === "sessionExpired" ? "sessionExpired" : "reconnecting",
    })),

  markRead: (conversationId) => {
    const state = get();
    const list = state.messagesByConversation[conversationId] ?? [];
    const lastSeq = maxSeqOf(list, state.lastSeqByConversation[conversationId] ?? 0);
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.conversation.id === conversationId ? { ...c, unread_count: 0 } : c,
      ),
      lastReadByUser: {
        ...s.lastReadByUser,
        [conversationId]: {
          ...(s.lastReadByUser[conversationId] ?? {}),
          ...(s.user !== null ? { [s.user.id]: lastSeq } : {}),
        },
      },
    }));
    if (lastSeq > 0) {
      void endpoints.markRead(conversationId, lastSeq).catch(() => {
        /* contadores serão re-sincronizados no próximo /conversations */
      });
    }
  },

  reset: () => {
    // Logout: limpa a sessão. RASCUNHOS SÃO PRESERVADOS (regra do repo:
    // sessão expirada/logout não descarta o que o usuário digitou).
    const { drafts, appVersion, lastServerVersion, mutedConversations } = get();
    set({
      user: null,
      users: [],
      conversations: [],
      messagesByConversation: {},
      presence: {},
      statusNotes: {},
      typing: {},
      lastReadByUser: {},
      lastSeqByConversation: {},
      activeConversationId: null,
      drafts,
      connection: "connecting",
      reconnectAttempt: 0,
      connected: false,
      sessionExpired: false,
      sessionLocked: false,
      myStatus: "available",
      autoAway: false,
      previousStatus: null,
      statusMessage: null,
      outbox: [],
      serverVersion: null,
      serverVersionNotice: false,
      appVersion,
      lastServerVersion,
      mutedConversations,
      lastNudge: null,
    });
    void clearOutbox();
  },

  // -----------------------------------------------------------------------
  // Ações novas
  // -----------------------------------------------------------------------

  setDraft: (conversationId, text) =>
    set((state) => ({ drafts: { ...state.drafts, [conversationId]: text } })),

  setConnection: (connection, attempt) =>
    set({ connection, reconnectAttempt: attempt, connected: connection === "online" }),

  setSessionExpired: (expired) => set({ sessionExpired: expired }),

  setSessionLocked: (locked) => set({ sessionLocked: locked }),

  setWindowFocused: (focused) => set({ windowFocused: focused }),

  appendMessages: (conversationId, messages) =>
    set((state) => {
      let list = state.messagesByConversation[conversationId] ?? [];
      for (const message of messages) {
        list = reconcileIntoList(list, message);
      }
      return {
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: list },
        lastSeqByConversation: {
          ...state.lastSeqByConversation,
          [conversationId]: maxSeqOf(list, state.lastSeqByConversation[conversationId] ?? 0),
        },
      };
    }),

  applyIncomingMessage: (message) =>
    set((state) => {
      const own = state.user !== null && message.sender_id === state.user.id;
      const list = reconcileIntoList(
        state.messagesByConversation[message.conversation_id] ?? [],
        message,
      );
      const bumpUnread =
        !own && !(state.activeConversationId === message.conversation_id && state.windowFocused);
      return {
        messagesByConversation: { ...state.messagesByConversation, [message.conversation_id]: list },
        lastSeqByConversation: {
          ...state.lastSeqByConversation,
          [message.conversation_id]: Math.max(
            message.seq,
            state.lastSeqByConversation[message.conversation_id] ?? 0,
          ),
        },
        conversations: state.conversations.map((c) =>
          c.conversation.id === message.conversation_id
            ? {
                ...c,
                unread_count: bumpUnread ? c.unread_count + 1 : c.unread_count,
                last_message: message,
              }
            : c,
        ),
      };
    }),

  setLastRead: (conversationId, userId, lastReadSeq) =>
    set((state) => ({
      lastReadByUser: {
        ...state.lastReadByUser,
        [conversationId]: {
          ...(state.lastReadByUser[conversationId] ?? {}),
          [userId]: lastReadSeq,
        },
      },
    })),

  setStatusMessage: (text) =>
    set(() => ({
      statusMessage:
        text === null || text.trim() === ""
          ? null
          : {
              text: text.trim().slice(0, STATUS_MESSAGE_MAX_CHARS),
              expiresAt: Date.now() + STATUS_MESSAGE_TTL_MS,
            },
    })),

  expireStatusMessage: () =>
    set((state) =>
      state.statusMessage !== null && state.statusMessage.expiresAt <= Date.now()
        ? { statusMessage: null }
        : {},
    ),

  setAutoAway: (away) =>
    set((state) => ({
      autoAway: away,
      previousStatus: away && !state.autoAway ? state.myStatus : state.previousStatus,
      myStatus: away ? "away" : state.myStatus,
    })),

  restoreFromAutoAway: () =>
    set((state) => ({
      autoAway: false,
      myStatus: state.autoAway ? state.previousStatus ?? "available" : state.myStatus,
      previousStatus: null,
    })),

  hydrateOutbox: (entries) =>
    set((state) => {
      const senderId = state.user?.id ?? "";
      const messages = { ...state.messagesByConversation };
      for (const entry of entries) {
        const list = messages[entry.conversationId] ?? [];
        const exists = list.some((m) => m.client_id === entry.clientId);
        if (!exists) {
          const restored = optimisticMessage(entry, senderId);
          restored.local = { status: "failed", queuedAt: entry.queuedAt, errorKey: entry.lastErrorKey ?? undefined };
          messages[entry.conversationId] = sortMessages([...list, restored]);
        } else {
          messages[entry.conversationId] = withLocalStatus(
            list,
            entry.clientId,
            "failed",
            entry.lastErrorKey ?? undefined,
          );
        }
      }
      return { messagesByConversation: messages, outbox: entries };
    }),

  sendMessage: ({ conversationId, body, attachmentIds }) => {
    const clientId = newClientId();
    const now = Date.now();
    const entry: OutboxEntry = {
      clientId,
      conversationId,
      body,
      attachmentIds: attachmentIds ?? [],
      queuedAt: now,
      attempts: 0,
      lastErrorKey: null,
      permanent: false,
    };
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: sortMessages([
          ...(state.messagesByConversation[conversationId] ?? []),
          optimisticMessage(entry, state.user?.id ?? ""),
        ]),
      },
      drafts: { ...state.drafts, [conversationId]: "" },
      outbox: [...state.outbox, entry],
    }));
    void persistOutbox(get().outbox);
    void attemptSend(get, set, clientId);
  },

  retryMessage: (clientId) => {
    const state = get();
    const entry = state.outbox.find((e) => e.clientId === clientId);
    if (entry === undefined) {
      // Entrada permanente foi descartada da fila — reconstruí-la do rascunho
      // otimista preservado na lista de mensagens (mesmo client_id!).
      const message = Object.values(state.messagesByConversation)
        .flatMap((list) => list)
        .find((m) => m.client_id === clientId);
      if (message === undefined) return;
      const rebuilt: OutboxEntry = {
        clientId,
        conversationId: message.conversation_id,
        body: message.body,
        attachmentIds: [],
        queuedAt: message.local?.queuedAt ?? Date.now(),
        attempts: 0,
        lastErrorKey: null,
        permanent: false,
      };
      set((s) => ({ outbox: [...s.outbox, rebuilt] }));
      void persistOutbox(get().outbox);
    }
    void attemptSend(get, set, clientId);
  },

  dismissFailedMessage: (clientId) => {
    set((state) => ({
      outbox: state.outbox.filter((e) => e.clientId !== clientId),
      messagesByConversation: Object.fromEntries(
        Object.entries(state.messagesByConversation).map(([conversationId, list]) => [
          conversationId,
          list.filter((m) => m.client_id !== clientId),
        ]),
      ),
    }));
    void persistOutbox(get().outbox);
  },

  flushOutbox: async () => {
    const entries = get()
      .outbox.filter((e) => !e.permanent)
      .sort((a, b) => a.queuedAt - b.queuedAt);
    for (const entry of entries) {
      await attemptSend(get, set, entry.clientId);
    }
  },

  setLastNudge: (event) => set({ lastNudge: event }),

  applyServerVersion: (version) =>
    set((state) => ({
      serverVersion: version,
      serverVersionNotice:
        state.lastServerVersion !== null && state.lastServerVersion !== version,
    })),

  ackServerVersion: () => {
    const version = get().serverVersion;
    if (version === null) {
      set({ serverVersionNotice: false });
      return;
    }
    set({ serverVersionNotice: false, lastServerVersion: version });
    void setPreferences({ lastServerVersion: version });
  },

  setAppVersion: (version) => set({ appVersion: version }),

  setLastServerVersion: (version) => set({ lastServerVersion: version }),

  setMutedConversations: (conversationIds) => set({ mutedConversations: conversationIds }),
}));

type GetState = () => AppState;
type SetState = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
) => void;

/**
 * Uma tentativa de envio. Sempre com o client_id original — o servidor é
 * idempotente por (conversation_id, client_id), então retry nunca duplica.
 */
async function attemptSend(get: GetState, set: SetState, clientId: string): Promise<void> {
  const entry = get().outbox.find((e) => e.clientId === clientId);
  if (entry === undefined || entry.permanent) return;

  set((state) => ({
    messagesByConversation: {
      ...state.messagesByConversation,
      [entry.conversationId]: withLocalStatus(
        state.messagesByConversation[entry.conversationId] ?? [],
        clientId,
        "sending",
      ),
    },
  }));

  try {
    const result = await endpoints.sendMessage({
      conversation_id: entry.conversationId,
      client_id: entry.clientId,
      body: entry.body,
      attachment_ids: entry.attachmentIds,
    });
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [entry.conversationId]: reconcileIntoList(
          state.messagesByConversation[entry.conversationId] ?? [],
          result,
        ),
      },
      lastSeqByConversation: {
        ...state.lastSeqByConversation,
        [entry.conversationId]: Math.max(
          result.seq,
          state.lastSeqByConversation[entry.conversationId] ?? 0,
        ),
      },
      outbox: state.outbox.filter((e) => e.clientId !== clientId),
    }));
    void persistOutbox(get().outbox);
  } catch (error) {
    const apiError = error instanceof ApiError;
    const status = apiError ? error.status : 0;
    // 5xx/rede/401/429 → reenviável (fila persiste); 4xx definitivo → falha
    // permanente, sai da fila mas continua visível com "Reenviar".
    const permanent = apiError && status >= 400 && status < 500 && status !== 401 && status !== 429;
    const errorKey = apiError ? `errors.api.${error.code}` : "errors.send.networkFailed";
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [entry.conversationId]: withLocalStatus(
          state.messagesByConversation[entry.conversationId] ?? [],
          clientId,
          "failed",
          errorKey,
        ),
      },
      outbox:
        permanent === true
          ? state.outbox.filter((e) => e.clientId !== clientId)
          : state.outbox.map((e) =>
              e.clientId === clientId
                ? { ...e, attempts: e.attempts + 1, lastErrorKey: errorKey }
                : e,
            ),
    }));
    void persistOutbox(get().outbox);
  }
}
