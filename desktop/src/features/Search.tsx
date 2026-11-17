import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store";
import { Avatar } from "../components/ui";
import type { Conversation, User } from "../types";

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const users = useApp((s) => s.users);
  const setActive = useApp((s) => s.setActiveConversation);
  const me = useApp((s) => s.user);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return users.filter(
      (u) => u.id !== me?.id && u.display_name.toLowerCase().includes(q),
    );
  }, [query, users, me]);

  if (!open) return null;

  async function openDm(user: User) {
    const conversation = await api.post<Conversation>("/conversations/dm", {
      user_id: user.id,
    });
    void useApp.getState().setConversations;
    setActive(conversation.id);
    onClose();
    void refreshConversations();
  }

  async function refreshConversations() {
    const list = await api.get<{ conversation: Conversation; unread_count: number; last_message: null }[]>(
      "/conversations",
    );
    useApp.getState().setConversations(
      list.map((s) => ({ ...s, last_message: s.last_message })),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <Search size={16} className="text-[var(--text-3)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pessoas…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-3)]"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {filteredUsers.map((user) => (
            <button
              key={user.id}
              onClick={() => void openDm(user)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
            >
              <Avatar name={user.display_name} size={24} />
              <span className="text-sm">{user.display_name}</span>
              <span className="text-xs text-[var(--text-3)]">@{user.username}</span>
            </button>
          ))}
          {query.trim() && filteredUsers.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-[var(--text-3)]">Nenhum resultado</p>
          )}
        </div>
      </div>
    </div>
  );
}
