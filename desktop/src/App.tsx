import { useEffect, useRef, useState } from "react";
import { LogOut, Shield } from "lucide-react";
import { api, clear, getRefreshToken, initAuth } from "./lib/api";
import { WsClient } from "./lib/ws";
import { useApp } from "./store";
import { AdminPanel } from "./features/AdminPanel";
import { Login } from "./features/Login";
import { Sidebar } from "./features/Sidebar";
import { Conversation as ConversationPane } from "./features/Conversation";
import { SearchPalette } from "./features/Search";
import { t } from "./i18n/pt-BR";
import type { ConversationSummary, Message, PresenceStatus, User } from "./types";

function parsePresence(value: unknown): PresenceStatus | null {
  switch (value) {
    case "available":
    case "busy":
    case "away":
    case "dnd":
    case "invisible":
    case "offline":
      return value;
    case "online":
      return "available";
    default:
      return null;
  }
}

export function App() {
  const user = useApp((s) => s.user);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hasToken = await initAuth();
      if (hasToken) {
        try {
          const me = await api.get<User>("/me");
          if (!cancelled) useApp.getState().setUser(me);
        } catch {
          await clear();
        }
      }
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booted) return null;
  return user ? <Shell /> : <Login />;
}

function Shell() {
  const user = useApp((s) => s.user);
  const reset = useApp((s) => s.reset);
  const setConversations = useApp((s) => s.setConversations);
  const setUsers = useApp((s) => s.setUsers);
  const setConnected = useApp((s) => s.setConnected);
  const addMessage = useApp((s) => s.addMessage);
  const updateMessage = useApp((s) => s.updateMessage);
  const removeMessage = useApp((s) => s.removeMessage);
  const setPresence = useApp((s) => s.setPresence);
  const setTyping = useApp((s) => s.setTyping);
  const activeId = useApp((s) => s.activeConversationId);
  const markRead = useApp((s) => s.markRead);
  const [searchOpen, setSearchOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const ws = new WsClient();
    ws.onStatus((online) => setConnected(online));
    ws.onEvent((event) => {
      switch (event.type) {
        case "message.created": {
          const message = event.payload as unknown as Message;
          addMessage(message);
          if (message.conversation_id === activeIdRef.current) {
            void api.post(`/conversations/${message.conversation_id}/read`, {
              last_read_seq: message.seq,
            });
            markRead(message.conversation_id);
          }
          break;
        }
        case "message.updated":
          updateMessage(event.payload as unknown as Message);
          break;
        case "message.deleted": {
          const payload = event.payload as { conversation_id: string; message_id: string };
          removeMessage(payload.conversation_id, payload.message_id);
          break;
        }
        case "presence.changed": {
          const payload = event.payload as { user_id: string; status: unknown };
          const status = parsePresence(payload.status);
          if (status) setPresence(payload.user_id, status);
          break;
        }
        case "hello": {
          const payload = event.payload as { presence?: Record<string, unknown> };
          if (payload.presence) {
            for (const [userId, value] of Object.entries(payload.presence)) {
              const status = parsePresence(value);
              if (status) setPresence(userId, status);
            }
          }
          setConnected(true);
          break;
        }
        case "typing": {
          const payload = event.payload as {
            conversation_id: string;
            user_id: string;
            is_typing: boolean;
          };
          setTyping(payload.conversation_id, payload.user_id, payload.is_typing);
          break;
        }
      }
    });
    void ws.connect();
    return () => ws.close();
  }, [
    addMessage,
    updateMessage,
    removeMessage,
    setPresence,
    setTyping,
    setConnected,
    markRead,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const conversations = await api.get<ConversationSummary[]>("/conversations");
        setConversations(conversations);
      } catch {
        /* mantém o estado atual */
      }
      try {
        const users = await api.get<User[]>("/users");
        setUsers(users);
      } catch {
        /* mantém o estado atual */
      }
    })();
  }, [setConversations, setUsers]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    const refresh = getRefreshToken();
    await clear();
    setAdminOpen(false);
    reset();
    if (refresh) {
      void api.post("/auth/logout", { refresh_token: refresh }).catch(() => {
        /* sessão já pode estar expirada */
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="titlebar-drag flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--titlebar)] px-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
          Microzup
        </div>
        <div className="titlebar-no-drag flex items-center gap-1">
          {user?.role === "admin" && (
            <button
              onClick={() => setAdminOpen(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
            >
              <Shield size={14} /> {t.admin.title}
            </button>
          )}
          <button
            onClick={() => void logout()}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
          >
            <LogOut size={14} /> {t.nav.logout}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <ConversationPane />
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      {adminOpen && user?.role === "admin" && (
        <AdminPanel onClose={() => setAdminOpen(false)} />
      )}
    </div>
  );
}
