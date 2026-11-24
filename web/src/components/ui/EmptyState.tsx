import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  /** Frase principal (chave i18n resolvida pelo chamador). */
  title: string;
  hint?: string;
  /** Ação opcional (botão/link já renderizado). */
  action?: ReactNode;
  className?: string;
}

/** Estado vazio (§7/§9): ícone + frase + ação, centrado no painel. */
export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-full)] bg-[var(--bg-hover)] text-[var(--text-3)]"
      >
        {icon}
      </span>
      <p className="text-[length:var(--fs-body)] font-medium text-[var(--text-2)]">{title}</p>
      {hint && (
        <p className="max-w-[420px] text-[length:var(--fs-list)] leading-[var(--lh-body)] text-[var(--text-3)]">
          {hint}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
