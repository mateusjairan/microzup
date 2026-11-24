import { useI18n } from "../../app/I18nProvider";

export interface UnreadDividerProps {
  className?: string;
}

/** Divisor "novas mensagens" (§8.2): marca a primeira não lida ao abrir. */
export function UnreadDivider({ className }: UnreadDividerProps) {
  const t = useI18n();
  return (
    <div className={`flex items-center gap-2 py-2 ${className ?? ""}`} role="separator" aria-label={t.conversation.newMessages}>
      <span className="h-px flex-1 bg-[var(--accent)] opacity-40" aria-hidden="true" />
      <span className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-0.5 text-[length:var(--fs-meta)] font-semibold text-white">
        {t.conversation.newMessages}
      </span>
      <span className="h-px flex-1 bg-[var(--accent)] opacity-40" aria-hidden="true" />
    </div>
  );
}
