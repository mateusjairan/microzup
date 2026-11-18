import type { ReactNode } from "react";
import { BellOff } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { Avatar } from "../ui/Avatar";
import { UnreadBadge } from "../ui/UnreadBadge";
import type { PresenceStatus } from "../ui/presence";

export interface ContactRowProps {
  name: string;
  avatarUrl?: string;
  presence?: PresenceStatus;
  /** Linha secundária (última mensagem, recado, "digitando…" — i18n do chamador). */
  secondary?: ReactNode;
  /** Recado de status do par (§8.3) — vira tooltip e é legível por teclado. */
  note?: string;
  unread?: number;
  selected?: boolean;
  muted?: boolean;
  /** Mostra os 3 pontos de digitando na linha. */
  typing?: boolean;
  /** Usuário desativado (§9): linha cinza + "inativo", DM bloqueada. */
  inactive?: boolean;
  onClick?: () => void;
  /** Menu de contexto (Dropdown) — alvo de 32 px. */
  menu?: ReactNode;
  className?: string;
}

function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5 px-0.5">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="inline-block h-1 w-1 rounded-[var(--radius-full)] bg-[var(--text-3)]"
          style={{
            animation: `mz-typing-dot 1.2s ${dot * 0.15}s ease-in-out infinite`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Linha de contato/conversa (§7): exatamente 32 px, estados selecionado,
 * não-lido, digitando e silenciado. Navegação de teclado vem do botão nativo —
 * sem roubar foco do composer.
 */
export function ContactRow({
  name,
  avatarUrl,
  presence,
  secondary,
  note,
  unread,
  selected = false,
  muted = false,
  typing = false,
  inactive = false,
  onClick,
  menu,
  className,
}: ContactRowProps) {
  const t = useI18n();
  const noteTitle = note === undefined || note === "" ? undefined : `${name} · ${note}`;
  return (
    <div
      className={`tz-colors group flex h-8 items-center gap-2 rounded-[var(--radius-sm)] pr-1 ${
        selected ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"
      } ${inactive ? "opacity-60" : ""} ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={inactive}
        aria-current={selected ? "true" : undefined}
        title={noteTitle}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-1 text-left"
      >
        <Avatar name={name} src={avatarUrl} size={20} presence={presence} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span
              className={`truncate text-[length:var(--fs-list)] leading-none ${
                inactive ? "text-[var(--text-3)]" : "text-[var(--text)]"
              }`}
            >
              {name}
            </span>
            {inactive && (
              <span className="shrink-0 text-[length:var(--fs-meta)] text-[var(--text-3)]">
                · {t.chat.contact.inactive}
              </span>
            )}
          </span>
          {secondary && (
            <span className="flex items-center gap-1 text-[length:var(--fs-meta)] leading-none text-[var(--text-3)]">
              {typing && <TypingDots />}
              <span className="truncate">{secondary}</span>
            </span>
          )}
        </span>
      </button>
      {muted && (
        <span
          title={t.chat.header.muted}
          aria-label={t.chat.header.muted}
          className="flex h-8 w-6 shrink-0 items-center justify-center text-[var(--text-3)]"
        >
          <BellOff size={12} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      {unread !== undefined && unread > 0 && <UnreadBadge count={unread} />}
      {menu && <span className="flex shrink-0 items-center">{menu}</span>}
    </div>
  );
}
