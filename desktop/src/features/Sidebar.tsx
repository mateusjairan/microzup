import { Hash, Users } from "lucide-react";
import { useApp } from "../store";
import { Avatar, PresenceDot } from "../components/ui";
import { t } from "../i18n/pt-BR";
import type { ConversationSummary, PresenceStatus } from "../types";

function dmTitle(summary: ConversationSummary): string {
  const other = summary.conversation.name ?? "";
  return other || "Conversa";
}

function Row({
  summary,
  active,
  onSelect,
}: {
  summary: ConversationSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const presence = useApp((s) => s.presence);
  const users = useApp((s) => s.users);
  const isDm = summary.conversation.kind === "dm";
  const label = isDm ? dmTitle(summary) : (summary.conversation.name ?? "Setor");
  const otherId = summary.last_message?.sender_id;
  const other = users.find((u) => u.id === otherId);

  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"
      }`}
    >
      {isDm ? (
        <Avatar name={label} status={(presence[otherId ?? ""] ?? "offline") as PresenceStatus} size={24} />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
          <Hash size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {label}
        {summary.last_message && (
          <span className="block truncate text-xs text-[var(--text-3)]">
            {other ? `${other.display_name}: ` : ""}
            {summary.last_message.body}
          </span>
        )}
      </span>
      {summary.unread_count > 0 && (
        <span className="rounded-full bg-[var(--accent)] px-1.5 text-xs font-medium text-white">
          {summary.unread_count}
        </span>
      )}
    </button>
  );
}

export function Sidebar() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeConversationId);
  const setActive = useApp((s) => s.setActiveConversation);
  const user = useApp((s) => s.user);
  const myStatus = useApp((s) => s.myStatus);

  const channels = conversations.filter((c) => c.conversation.kind === "channel");
  const dms = conversations.filter((c) => c.conversation.kind === "dm");

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <Avatar name={user?.display_name ?? "?"} status={myStatus} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{user?.display_name}</div>
          <div className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            <PresenceDot status={myStatus} /> {t.status[myStatus]}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {channels.length > 0 && (
          <div className="mb-1 mt-1 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">
            {t.nav.sectors}
          </div>
        )}
        {channels.map((c) => (
          <Row
            key={c.conversation.id}
            summary={c}
            active={activeId === c.conversation.id}
            onSelect={() => setActive(c.conversation.id)}
          />
        ))}

        {dms.length > 0 && (
          <div className="mb-1 mt-3 flex items-center gap-1 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">
            <Users size={12} /> {t.nav.conversations}
          </div>
        )}
        {dms.map((c) => (
          <Row
            key={c.conversation.id}
            summary={c}
            active={activeId === c.conversation.id}
            onSelect={() => setActive(c.conversation.id)}
          />
        ))}

        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--text-3)]">
            Nenhuma conversa ainda.
          </p>
        )}
      </div>
    </aside>
  );
}
