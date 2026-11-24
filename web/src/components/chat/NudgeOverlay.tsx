import { useEffect } from "react";
import { Bell, X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import { useReducedMotion } from "../utils/useReducedMotion";

export interface NudgeOverlayProps {
  /** true enquanto o efeito dura (chamador controla o ciclo 1×/5 min, §8.4). */
  active: boolean;
  senderName: string;
  onDismiss: () => void;
  className?: string;
}

/**
 * "Chamar atenção" (§8.4): flash SUTIL do véu de destaque + aviso textual.
 * NUNCA shake (§16). Em prefers-reduced-motion o keyframe vira corte seco
 * (tokens.css) e só o aviso textual aparece. O flashFrame na taskbar é
 * responsabilidade da casca Electron (etapa de wiring).
 */
export function NudgeOverlay({ active, senderName, onDismiss, className }: NudgeOverlayProps) {
  const t = useI18n();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(onDismiss, 8_000);
    return () => window.clearTimeout(timer);
  }, [active, onDismiss]);

  if (!active) return null;

  return (
    <div className={`pointer-events-none absolute inset-0 z-40 ${className ?? ""}`}>
      {!reducedMotion && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[var(--accent)]"
          style={{ animation: "mz-nudge-flash 600ms var(--ease) 1 both" }}
        />
      )}
      <div
        role="status"
        className="tz-colors pointer-events-auto absolute right-3 top-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] py-1 pl-2 pr-1 shadow-[var(--shadow-2)]"
        style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
      >
        <Bell size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
        <span className="text-[length:var(--fs-list)] text-[var(--text)]">
          {interpolate(t.chat.nudge.message, { name: senderName })}
        </span>
        <button
          type="button"
          aria-label={t.ui.close}
          onClick={onDismiss}
          className="tz-colors flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
