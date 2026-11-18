import type { InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Campo de texto (§7) — alvo ≥ 32 px, foco visível global, tokens only. */
export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      className={`h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[length:var(--fs-body)] leading-[var(--lh-body)] text-[var(--text)] outline-none placeholder:text-[var(--text-3)] disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
      {...rest}
    />
  );
}
