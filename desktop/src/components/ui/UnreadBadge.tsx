import { useI18n } from "../../app/I18nProvider";

export interface UnreadBadgeProps {
  /** 1–99 vira número; acima de 99 vira "99+" (§7). 0/undefined não renderiza. */
  count: number;
  className?: string;
}

/** Badge de não-lidas — acento único do produto, números tabulares. */
export function UnreadBadge({ count, className }: UnreadBadgeProps) {
  const t = useI18n();
  if (!Number.isFinite(count) || count <= 0) return null;
  const label = count > 99 ? t.ui.unreadOverflow : String(count);
  return (
    <span
      className={`nums-tabular inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent)] px-1 text-[length:var(--fs-meta)] font-semibold leading-none text-white ${className ?? ""}`}
    >
      {label}
    </span>
  );
}
