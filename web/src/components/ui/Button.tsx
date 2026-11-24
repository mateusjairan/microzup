import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader } from "lucide-react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  /** Estado de carregamento: spinner + desabilitado (§2 honestidade de estado). */
  loading?: boolean;
  /** Ícone à esquerda do rótulo. */
  icon?: ReactNode;
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-transparent",
  secondary:
    "bg-[var(--bg-surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)]",
  ghost:
    "bg-transparent text-[var(--text-2)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
  danger:
    "bg-[var(--danger)] text-white border border-transparent hover:opacity-90",
};

const SIZE_CLASS: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-[length:var(--fs-list)]",
  md: "h-9 px-4 text-[length:var(--fs-body)]",
};

/** Botão (§7) — alvo ≥ 32 px, foco visível global (tokens.css), spinner em loading. */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`tz-colors inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] font-medium disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className ?? ""}`}
      {...rest}
    >
      {loading ? (
        <Loader size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

/** Botão só-ícone: alvo 32×32 com aria-label obrigatório. */
export function IconButton({ label, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`tz-colors inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
