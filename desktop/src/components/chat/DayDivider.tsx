import { useI18n } from "../../app/I18nProvider";
import { formatDayLabel } from "../utils/format";

export interface DayDividerProps {
  /** ISO da primeira mensagem do dia. */
  iso: string;
  className?: string;
}

/** Divisor de dia (§7): "Hoje" · "Ontem" · data completa (date-fns, pt-BR). */
export function DayDivider({ iso, className }: DayDividerProps) {
  const t = useI18n();
  const label = formatDayLabel(iso, {
    today: t.conversation.today,
    yesterday: t.conversation.yesterday,
  });
  return (
    <div className={`flex items-center gap-2 py-2 ${className ?? ""}`} role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-[var(--border)]" aria-hidden="true" />
      <span className="text-[length:var(--fs-meta)] font-medium text-[var(--text-3)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--border)]" aria-hidden="true" />
    </div>
  );
}
