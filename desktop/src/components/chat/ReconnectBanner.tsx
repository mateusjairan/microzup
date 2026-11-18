import { RefreshCw, WifiOff } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";

export interface ReconnectBannerProps {
  /** "connecting" = backoff em curso ("reconectando (n/∞)"); "offline" = sem conexão. */
  state: "connecting" | "offline";
  /** Número da tentativa atual (n de n/∞, §9). */
  attempt?: number;
  onTryNow?: () => void;
  className?: string;
}

/**
 * Banner de reconexão (§8.5/§9): persistente abaixo da barra de título —
 * banner, NÃO toast. "Tentar agora" dispara reconexão imediata.
 */
export function ReconnectBanner({ state, attempt, onTryNow, className }: ReconnectBannerProps) {
  const t = useI18n();
  const text =
    state === "connecting"
      ? interpolate(t.chat.reconnect.connecting, { attempt: attempt ?? 1 })
      : t.chat.reconnect.offline;

  return (
    <div
      role="status"
      aria-label={t.chat.reconnect.bannerLabel}
      className={`flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[length:var(--fs-list)] text-[var(--text-2)] ${className ?? ""}`}
    >
      {state === "connecting" ? (
        <RefreshCw size={14} strokeWidth={2} aria-hidden="true" className="animate-spin text-[var(--warning)]" />
      ) : (
        <WifiOff size={14} strokeWidth={2} aria-hidden="true" className="text-[var(--danger)]" />
      )}
      <span className="truncate">{text}</span>
      {onTryNow && (
        <button
          type="button"
          onClick={onTryNow}
          className="tz-colors ml-auto flex h-8 shrink-0 items-center rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-meta)] font-medium text-[var(--accent)] hover:bg-[var(--bg-hover)]"
        >
          {t.chat.reconnect.tryNow}
        </button>
      )}
    </div>
  );
}
