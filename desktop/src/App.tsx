import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { api } from "./lib/api";
import { clearTokens } from "./lib/bridge";
import { WsClient } from "./lib/ws";
import { useApp } from "./store";
import { Login } from "./features/Login";
import { Sidebar } from "./features/Sidebar";
import { Conversation as ConversationPane } from "./features/Conversation";
import { SearchPalette } from "./features/Search";
import type { ConversationSummary, Message, User } from "./types";

export function App() {
  const user = useApp((s) => s.user);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void (async () => {
      const { initAuth } = await import("./lib/api");
      const hasToken = await initAuth();
      if (hasToken && !user) {
        try {
          const me = await api.get<User>("/me");
          useApp.getState().setUser(me);
        } catch {
          await clearTokens();
        }
      }
      setBooted(true);
    })();
  }, [user]);

  if (!booted) return null;
  return user ? <Shell /> : <Login />;
}

function Shell() {
  const setUser = useApp((s) => s.setUser);
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

  useEffect(() => {
    const ws = new WsClient();
    ws.onEvent((event) => {
      switch (event.type) {
        case "message.created": {
          const message = event.payload as unknown as Message;
          addMessage(message);
          if (message.conversation_id === activeId) {
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
          const payload = event.payload as { user_id: string; status: string };
          setPresence(payload.user_id, payload.status as never);
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
      if (event.type === "hello") setConnected(true);
    });
    void ws.connect();
    return () => ws.close();
  }, [activeId, addMessage, updateMessage, removeMessage, setPresence, setTyping, setConnected, markRead]);

  useEffect(() => {
    void (async () => {
      try {
        const [conversations, users] = await Promise.all([
          api.get<ConversationSummary[]>("/conversations"),
          api.get<User[]>("/users"),
        ]);
        setConversations(conversations);
        setUsers(users);
      } catch {
        setConnected(false);
      }
    })();
  }, [setConversations, setUsers, setConnected]);

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
    await clearTokens();
    reset();
    setUser(null);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="titlebar-drag flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--titlebar)] px-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
          Microzup
        </div>
        <div className="titlebar-no-drag flex items-center gap-1">
          <button
            onClick={() => void logout()}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
          >
            <LogOut size={14} /> Sair
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <ConversationPane />
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
