import { useI18n } from "../../app/I18nProvider";
import { PRESENCE_COLOR_TOKEN, type PresenceStatus } from "../ui/presence";

export interface PresenceDotProps {
  status: PresenceStatus;
  /** Diâmetro do dot (padrão 10). */
  size?: number;
  /** Cor do anel de contraste — token CSS do fundo onde o dot assenta. */
  ringColor?: string;
  /** Mostra o rótulo textual ao lado do dot (§6: dot + texto, nunca só cor). */
  showLabel?: boolean;
  className?: string;
}

/**
 * Dot de presença (§6/§7): 5 status + offline, anel de contraste,
 * SEMPRE com aria-label — a cor nunca é o único canal.
 */
export function PresenceDot({
  status,
  size = 10,
  ringColor = "var(--presence-ring)",
  showLabel = false,
  className,
}: PresenceDotProps) {
  const t = useI18n();
  const label = t.status[status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <span
        role="img"
        aria-label={label}
        title={label}
        className="inline-block shrink-0 rounded-[var(--radius-full)]"
        style={{
          width: size,
          height: size,
          background: PRESENCE_COLOR_TOKEN[status],
          boxShadow: `0 0 0 2px ${ringColor}`,
        }}
      />
      {showLabel && <span className="text-[length:var(--fs-meta)] text-[var(--text-2)]">{label}</span>}
    </span>
  );
}
