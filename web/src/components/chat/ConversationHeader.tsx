import { Bell, BellOff, Hash, Maximize2, PanelRight } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import { Avatar } from "../ui/Avatar";
import { IconButton } from "../ui/Button";
import type { PresenceStatus } from "../ui/presence";
import { PresenceDot } from "./PresenceDot";

export interface ConversationHeaderProps {
  kind: "channel" | "dm";
  title: string;
  /** Canal: "{members} membros · {online} online" (§4). */
  memberCount?: number;
  onlineCount?: number;
  /** DM: presença e recado do par. */
  peerPresence?: PresenceStatus;
  peerNote?: string;
  peerAvatarUrl?: string;
  muted?: boolean;
  /** Conversa arquivada (§9): somente leitura — o composer explica. */
  archived?: boolean;
  onToggleMute?: () => void;
  onShowDetails?: () => void;
  onOpenInWindow?: () => void;
  className?: string;
}

/**
 * Cabeçalho da conversa (§4/§7): canal (#) ou DM (avatar), presença
 * agregada, e ações silenciar / detalhes / abrir em janela.
 */
export function ConversationHeader({
  kind,
  title,
  memberCount,
  onlineCount,
  peerPresence,
  peerNote,
  peerAvatarUrl,
  muted = false,
  archived = false,
  onToggleMute,
  onShowDetails,
  onOpenInWindow,
  className,
}: ConversationHeaderProps) {
  const t = useI18n();

  let subtitle: string;
  if (kind === "channel") {
    subtitle = interpolate(t.chat.header.membersOnline, {
      members: memberCount ?? 0,
      online: onlineCount ?? 0,
    });
  } else {
    subtitle = peerPresence ? t.status[peerPresence] : t.nav.unknownUser;
    if (peerNote) subtitle = `${subtitle} · ${peerNote}`;
  }
  const flags: string[] = [];
  if (muted) flags.push(t.chat.header.muted);
  if (archived) flags.push(t.chat.header.archived);
  const fullSubtitle = flags.length > 0 ? `${subtitle} · ${flags.join(" · ")}` : subtitle;

  return (
    <header
      className={`flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 ${className ?? ""}`}
    >
      {kind === "channel" ? (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]"
        >
          <Hash size={16} strokeWidth={2} />
        </span>
      ) : (
        <Avatar name={title} src={peerAvatarUrl} size={32} presence={peerPresence} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {kind === "dm" && peerPresence && (
            <PresenceDot status={peerPresence} size={8} ringColor="var(--bg-surface)" />
          )}
          <h2 className="truncate text-[length:var(--fs-panel)] font-semibold leading-[var(--lh-title)] text-[var(--text)]">
            {title}
          </h2>
        </div>
        <p className="truncate text-[length:var(--fs-meta)] leading-[var(--lh-body)] text-[var(--text-3)]">
          {fullSubtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onToggleMute && (
          <IconButton
            label={muted ? t.chat.header.unmute : t.chat.header.mute}
            onClick={onToggleMute}
            aria-pressed={muted}
          >
            {muted ? <BellOff size={16} strokeWidth={2} /> : <Bell size={16} strokeWidth={2} />}
          </IconButton>
        )}
        {onShowDetails && (
          <IconButton label={t.chat.header.details} onClick={onShowDetails}>
            <PanelRight size={16} strokeWidth={2} />
          </IconButton>
        )}
        {onOpenInWindow && (
          <IconButton label={t.chat.header.openInWindow} onClick={onOpenInWindow}>
            <Maximize2 size={16} strokeWidth={2} />
          </IconButton>
        )}
      </div>
    </header>
  );
}
