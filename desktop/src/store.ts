import { create } from "zustand";
import type {
  ConversationSummary,
  Message,
  PresenceStatus,
  User,
} from "./types";

interface AppState {
  user: User | null;
  users: User[];
  conversations: ConversationSummary[];
  messagesByConversation: Record<string, Message[]>;
  presence: Record<string, PresenceStatus>;
  typing: Record<string, string[]>;
  activeConversationId: string | null;
  myStatus: PresenceStatus;
  connected: boolean;

  setUser: (user: User | null) => void;
  setUsers: (users: User[]) => void;
  setConversations: (conversations: ConversationSummary[]) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  setPresence: (userId: string, status: PresenceStatus) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
  setActiveConversation: (conversationId: string | null) => void;
  setMyStatus: (status: PresenceStatus) => void;
  setConnected: (connected: boolean) => void;
  markRead: (conversationId: string) => void;
  reset: () => void;
}

export const useApp = create<AppState>((set) => ({
  user: null,
  users: [],
  conversations: [],
  messagesByConversation: {},
  presence: {},
  typing: {},
  activeConversationId: null,
  myStatus: "available",
  connected: false,

  setUser: (user) => set({ user }),
  setUsers: (users) => set({ users }),
  setConversations: (conversations) => set({ conversations }),
  setMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: messages,
      },
    })),
  addMessage: (message) =>
    set((state) => {
      const existing = state.messagesByConversation[message.conversation_id] ?? [];
      if (existing.some((m) => m.client_id === message.client_id && m.sender_id === message.sender_id)) {
        return state;
      }
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [message.conversation_id]: [...existing, message].sort((a, b) => a.seq - b.seq),
        },
      };
    }),
  updateMessage: (message) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [message.conversation_id]: (state.messagesByConversation[message.conversation_id] ?? []).map(
          (m) => (m.id === message.id ? message : m),
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
  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const current = state.typing[conversationId] ?? [];
      const next = isTyping
        ? Array.from(new Set([...current, userId]))
        : current.filter((id) => id !== userId);
      return { typing: { ...state.typing, [conversationId]: next } };
    }),
  setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),
  setMyStatus: (status) => set({ myStatus: status }),
  setConnected: (connected) => set({ connected }),
  markRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.conversation.id === conversationId ? { ...c, unread_count: 0 } : c,
      ),
    })),
  reset: () =>
    set({
      user: null,
      users: [],
      conversations: [],
      messagesByConversation: {},
      presence: {},
      typing: {},
      activeConversationId: null,
      connected: false,
    }),
}));
