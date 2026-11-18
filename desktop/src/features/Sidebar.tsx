import { useMemo, useState } from "react";
import { Hash, Users } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../store";
import { Avatar, PresenceDot } from "../components/ui";
import { t } from "../i18n/pt-BR";
import type {
  Conversation,
  ConversationSummary,
  PresenceStatus,
  User,
} from "../types";

function isOnline(status: PresenceStatus): boolean {
  return status !== "offline" && status !== "invisible";
}

function resolvePresence(
  presence: Record<string, PresenceStatus>,
  member: User,
): PresenceStatus {
  return presence[member.id] ?? member.presence ?? "offline";
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
  const peerId = summary.conversation.peer_id;
  const peer = users.find((user) => user.id === peerId);
  const label = isDm
    ? (peer?.display_name ?? t.nav.unknownUser)
    : (summary.conversation.name ?? t.nav.sectorFallback);
  const status = (peerId ? presence[peerId] : undefined) ?? peer?.presence ?? "offline";
  const sender = users.find((user) => user.id === summary.last_message?.sender_id);

  return (
    <button
      onClick={onSelect}
      title={isDm ? `${label} — ${t.status[status]}` : label}
      aria-label={isDm ? `${label} — ${t.status[status]}` : label}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"
      }`}
    >
      {isDm ? (
        <Avatar name={label} status={status} size={24} />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
          <Hash size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {label}
        {summary.last_message && (
          <span className="block truncate text-xs text-[var(--text-3)]">
            {sender ? `${sender.display_name}: ` : ""}
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

function TeamRow({
  member,
  status,
  busy,
  onStart,
}: {
  member: User;
  status: PresenceStatus;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <button
      onClick={onStart}
      disabled={busy}
      title={t.nav.startConversation}
      aria-label={`${member.display_name} — ${t.status[status]}. ${t.nav.startConversation}`}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
    >
      <Avatar name={member.display_name} status={status} size={24} />
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate">{member.display_name}</span>
        <span className="block text-xs text-[var(--text-3)]">{t.status[status]}</span>
      </span>
    </button>
  );
}

export function Sidebar() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeConversationId);
  const setActive = useApp((s) => s.setActiveConversation);
  const setConversations = useApp((s) => s.setConversations);
  const user = useApp((s) => s.user);
  const users = useApp((s) => s.users);
  const presence = useApp((s) => s.presence);
  const myStatus = useApp((s) => s.myStatus);
  const [dmBusy, setDmBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const channels = conversations.filter((c) => c.conversation.kind === "channel");
  const dms = conversations.filter((c) => c.conversation.kind === "dm");

  const team = useMemo(
    () =>
      users
        .filter((member) => member.id !== user?.id && member.is_active)
        .map((member) => ({
          member,
          status: resolvePresence(presence, member),
        }))
        .sort((a, b) => {
          const difference = Number(isOnline(b.status)) - Number(isOnline(a.status));
          return difference !== 0
            ? difference
            : a.member.display_name.localeCompare(b.member.display_name);
        }),
    [users, user?.id, presence],
  );

  const onlineCount = team.filter((entry) => isOnline(entry.status)).length;

  async function startDm(member: User) {
    setDmBusy(member.id);
    setError(null);
    try {
      const conversation = await api.post<Conversation>("/conversations/dm", {
        user_id: member.id,
      });
      const next = await api.get<ConversationSummary[]>("/conversations");
      setConversations(next);
      setActive(conversation.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.nav.openDmError);
    } finally {
      setDmBusy(null);
    }
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <Avatar name={user?.display_name ?? "?"} status={myStatus} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{user?.display_name}</div>
          <div className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            <PresenceDot status={myStatus} />
            {t.status[myStatus]}
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

        <div className="mb-1 mt-3 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">
          <span className="flex items-center gap-1">
            <Users size={12} /> {t.nav.team}
          </span>
          <span className="normal-case tracking-normal">
            {onlineCount}/{team.length}
          </span>
        </div>
        {team.map(({ member, status }) => (
          <TeamRow
            key={member.id}
            member={member}
            status={status}
            busy={dmBusy === member.id}
            onStart={() => void startDm(member)}
          />
        ))}
        {team.length === 0 && (
          <p className="px-2 py-2 text-sm text-[var(--text-3)]">{t.nav.teamEmpty}</p>
        )}
        {error && (
          <p role="alert" className="px-2 py-2 text-xs text-[var(--danger)]">
            {error}
          </p>
        )}

        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--text-3)]">
            {t.nav.noConversations}
          </p>
        )}
      </div>
    </aside>
  );
}
