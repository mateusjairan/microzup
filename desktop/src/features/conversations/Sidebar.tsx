import { useMemo, useState } from "react";
import { Hash, MessageSquarePlus, Search } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../../components/utils/format";
import { Avatar, UnreadBadge } from "../../components/ui";
import { ContactRow } from "../../components/chat";
import { SidebarGroup } from "../../components/chat/SidebarGroup";
import type { PresenceStatus } from "../../components/ui/presence";
import { endpoints, ApiError } from "../../lib/api";
import { useApp } from "../../store";
import type { ConversationSummary, User } from "../../types";

export interface SidebarProps {
  collapsed: boolean;
  onOpenSearch: () => void;
  onNewConversation: () => void;
}

function isOnline(status: PresenceStatus): boolean {
  return status !== "offline" && status !== "invisible";
}

/**
 * Ordem da sidebar (e da navegação Alt+↑/↓, §10): setores por nome, depois
 * conversas diretas por atividade mais recente.
 */
export function orderedConversations(
  conversations: ConversationSummary[],
): ConversationSummary[] {
  const channels = conversations
    .filter((summary) => summary.conversation.kind === "channel")
    .sort((a, b) =>
      (a.conversation.name ?? "").localeCompare(b.conversation.name ?? "", "pt-BR"),
    );
  const dms = conversations
    .filter((summary) => summary.conversation.kind === "dm")
    .sort(
      (a, b) =>
        new Date(b.last_message?.created_at ?? 0).getTime() -
        new Date(a.last_message?.created_at ?? 0).getTime(),
    );
  return [...channels, ...dms];
}

function presenceOf(
  presenceMap: Record<string, PresenceStatus>,
  user: User | undefined,
): PresenceStatus {
  if (user === undefined) return "offline";
  return presenceMap[user.id] ?? user.presence ?? "offline";
}

/** Sidebar (§4): meu cartão, setores, conversas por atividade, equipe, rodapé. */
export function Sidebar({ collapsed, onOpenSearch, onNewConversation }: SidebarProps) {
  const t = useI18n();
  const user = useApp((state) => state.user);
  const users = useApp((state) => state.users);
  const conversations = useApp((state) => state.conversations);
  const presence = useApp((state) => state.presence);
  const typing = useApp((state) => state.typing);
  const statusNotes = useApp((state) => state.statusNotes);
  const activeId = useApp((state) => state.activeConversationId);
  const myStatus = useApp((state) => state.myStatus);
  const statusMessage = useApp((state) => state.statusMessage);
  const connection = useApp((state) => state.connection);
  const reconnectAttempt = useApp((state) => state.reconnectAttempt);
  const muted = useApp((state) => state.mutedConversations);
  const setActive = useApp((state) => state.setActiveConversation);
  const setConversations = useApp((state) => state.setConversations);

  const [sectorsOpen, setSectorsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmBusy, setDmBusy] = useState<string | null>(null);

  const ordered = useMemo(() => orderedConversations(conversations), [conversations]);
  const channels = useMemo(() => ordered.filter((summary) => summary.conversation.kind === "channel"), [ordered]);
  const dms = useMemo(() => ordered.filter((summary) => summary.conversation.kind === "dm"), [ordered]);

  const team = useMemo(() => {
    return users
      .filter((member) => member.id !== user?.id)
      .map((member) => ({ member, status: presenceOf(presence, member) }))
      .sort((a, b) => {
        const difference = Number(isOnline(b.status)) - Number(isOnline(a.status));
        return difference !== 0
          ? difference
          : a.member.display_name.localeCompare(b.member.display_name, "pt-BR");
      });
  }, [users, user?.id, presence]);

  const onlineCount = team.filter((entry) => isOnline(entry.status) && entry.member.is_active).length;

  const nameOf = (summary: ConversationSummary): string =>
    summary.conversation.kind === "dm"
      ? (users.find((u) => u.id === summary.conversation.peer_id)?.display_name ?? t.nav.unknownUser)
      : (summary.conversation.name ?? t.nav.sectorFallback);

  const previewOf = (summary: ConversationSummary): string | undefined => {
    const last = summary.last_message;
    if (last === null) return undefined;
    const sender = users.find((u) => u.id === last.sender_id);
    const who = sender === undefined ? "" : sender.id === user?.id ? "" : `${sender.display_name}: `;
    return `${who}${last.body}`;
  };

  async function startDm(member: User) {
    setDmBusy(member.id);
    setDmError(null);
    try {
      const conversation = await endpoints.openDm(member.id);
      const next = await endpoints.listConversations();
      setConversations(next);
      setActive(conversation.id);
    } catch (error) {
      setDmError(error instanceof ApiError ? error.message : t.nav.openDmError);
    } finally {
      setDmBusy(null);
    }
  }

  const connectionLabel = (() => {
    switch (connection) {
      case "online":
        return { text: t.conn.online, color: "var(--presence-available)" };
      case "connecting":
        return { text: t.conn.connecting, color: "var(--text-3)" };
      case "reconnecting":
        return { text: interpolate(t.conn.reconnecting, { n: reconnectAttempt }), color: "var(--warning)" };
      case "offline":
        return { text: t.conn.offline, color: "var(--danger)" };
      case "sessionExpired":
        return { text: t.conn.sessionExpired, color: "var(--danger)" };
    }
  })();

  if (collapsed) {
    return (
      <aside
        className="flex w-[var(--sidebar-collapsed-width)] shrink-0 flex-col items-center gap-2 border-r border-[var(--border)] bg-[var(--bg-sidebar)] py-2"
        aria-label={t.appName}
      >
        <Avatar name={user?.display_name ?? "?"} size={32} presence={myStatus} />
        <span aria-hidden="true" className="h-px w-8 bg-[var(--border)]" />
        {channels.map((summary) => (
          <button
            key={summary.conversation.id}
            type="button"
            title={nameOf(summary)}
            aria-label={nameOf(summary)}
            aria-current={activeId === summary.conversation.id ? "true" : undefined}
            onClick={() => setActive(summary.conversation.id)}
            className={`tz-colors relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] ${
              activeId === summary.conversation.id
                ? "bg-[var(--bg-selected)] text-[var(--accent)]"
                : "text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <Hash size={16} strokeWidth={2} />
            {summary.unread_count > 0 && (
              <span className="absolute right-0 top-0">
                <UnreadBadge count={summary.unread_count} />
              </span>
            )}
          </button>
        ))}
        {dms.map((summary) => {
          const peer = users.find((u) => u.id === summary.conversation.peer_id);
          const status = presenceOf(presence, peer);
          return (
            <button
              key={summary.conversation.id}
              type="button"
              title={nameOf(summary)}
              aria-label={nameOf(summary)}
              aria-current={activeId === summary.conversation.id ? "true" : undefined}
              onClick={() => setActive(summary.conversation.id)}
              className="relative"
            >
              <Avatar name={nameOf(summary)} size={32} presence={status} />
              {summary.unread_count > 0 && (
                <span className="absolute -right-1 -top-1">
                  <UnreadBadge count={summary.unread_count} />
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onNewConversation}
          aria-label={t.nav.newConversation}
          title={t.nav.newConversation}
          className="tz-colors flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
        >
          <MessageSquarePlus size={16} strokeWidth={2} />
        </button>
        <div className="mt-auto flex items-center" title={connectionLabel.text} aria-label={connectionLabel.text}>
          <span
            role="img"
            aria-hidden="true"
            className="h-2 w-2 rounded-[var(--radius-full)]"
            style={{ background: connectionLabel.color }}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
      {/* Meu cartão */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <Avatar name={user?.display_name ?? "?"} size={32} presence={myStatus} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[length:var(--fs-list)] font-medium text-[var(--text)]">
            {user?.display_name}
          </p>
          <p className="flex items-center gap-1 text-[length:var(--fs-meta)] text-[var(--text-3)]">
            <span aria-hidden="true" className="truncate">
              {statusMessage === null ? t.sidebar.noRecado : `“${statusMessage.text}”`}
            </span>
          </p>
        </div>
      </div>

      {/* Busca rápida (Ctrl+K) — o texto visível É o nome acessível (sem
          aria-label divergente; axe label-content-name-mismatch). */}
      <div className="p-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="tz-colors flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-left text-[length:var(--fs-list)] text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
        >
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <span className="truncate">{t.nav.searchPlaceholder}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        <SidebarGroup
          title={t.nav.sectors}
          count={channels.length}
          collapsed={!sectorsOpen}
          onToggle={() => setSectorsOpen((open) => !open)}
        >
          {channels.map((summary) => (
            <ContactRow
              key={summary.conversation.id}
              name={nameOf(summary)}
              secondary={previewOf(summary)}
              unread={summary.unread_count}
              selected={activeId === summary.conversation.id}
              muted={muted.includes(summary.conversation.id)}
              onClick={() => setActive(summary.conversation.id)}
            />
          ))}
        </SidebarGroup>

        <SidebarGroup
          title={t.nav.conversations}
          count={dms.length}
          collapsed={!dmsOpen}
          onToggle={() => setDmsOpen((open) => !open)}
        >
          {dms.map((summary) => {
            const peer = users.find((u) => u.id === summary.conversation.peer_id);
            const status = presenceOf(presence, peer);
            const typingHere = (typing[summary.conversation.id] ?? []).length > 0;
            const peerNote = peer === undefined ? undefined : statusNotes[peer.id];
            return (
              <ContactRow
                key={summary.conversation.id}
                name={nameOf(summary)}
                presence={peer !== undefined && peer.is_active ? status : undefined}
                secondary={typingHere ? undefined : previewOf(summary)}
                note={peerNote === "" ? undefined : peerNote}
                unread={summary.unread_count}
                selected={activeId === summary.conversation.id}
                muted={muted.includes(summary.conversation.id)}
                typing={typingHere}
                onClick={() => setActive(summary.conversation.id)}
              />
            );
          })}
          <button
            type="button"
            onClick={onNewConversation}
            className="tz-colors flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[length:var(--fs-list)] text-[var(--accent)] hover:bg-[var(--bg-hover)]"
          >
            <MessageSquarePlus size={14} strokeWidth={2} aria-hidden="true" />
            {t.nav.newConversation}
          </button>
        </SidebarGroup>

        <SidebarGroup
          title={t.nav.team}
          count={onlineCount}
          collapsed={!teamOpen}
          onToggle={() => setTeamOpen((open) => !open)}
        >
          {team.map(({ member, status }) => (
            <ContactRow
              key={member.id}
              name={member.display_name}
              presence={member.is_active ? status : undefined}
              secondary={t.status[member.is_active ? status : "offline"]}
              note={statusNotes[member.id] === "" ? undefined : statusNotes[member.id]}
              inactive={!member.is_active}
              onClick={member.is_active ? () => void startDm(member) : undefined}
            />
          ))}
          {team.length === 0 && (
            <p className="px-2 py-2 text-[length:var(--fs-list)] text-[var(--text-3)]">{t.nav.teamEmpty}</p>
          )}
          {dmError && (
            <p role="alert" className="px-2 py-1 text-[length:var(--fs-meta)] text-[var(--danger)]">
              {dmError}
            </p>
          )}
          {dmBusy !== null && (
            <p role="status" className="px-2 py-1 text-[length:var(--fs-meta)] text-[var(--text-3)]">
              {t.ui.loading}
            </p>
          )}
        </SidebarGroup>

        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-[length:var(--fs-list)] text-[var(--text-3)]">
            {t.nav.noConversations}
          </p>
        )}
      </div>

      {/* Rodapé: estado da conexão */}
      <div
        className="flex h-8 shrink-0 items-center gap-2 border-t border-[var(--border)] px-3"
        aria-label={t.sidebar.connection}
      >
        <span
          role="img"
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-[var(--radius-full)]"
          style={{ background: connectionLabel.color }}
        />
        <span className="nums-tabular truncate text-[length:var(--fs-meta)] text-[var(--text-3)]">
          {connectionLabel.text}
        </span>
      </div>
    </aside>
  );
}
