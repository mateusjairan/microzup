import * as SwitchPrimitive from "@radix-ui/react-switch";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Rótulo acessível (obrigatório — o switch nunca fica sem nome). */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Switch Radix (§7) — 32 px de largura de toque, foco visível global. */
export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={`tz-colors inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--radius-full)] border border-transparent p-0.5 data-[state=checked]:bg-[var(--accent)] data-[state=unchecked]:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
    >
      <SwitchPrimitive.Thumb className="tz-colors block h-4 w-4 rounded-[var(--radius-full)] bg-white shadow-[var(--shadow-1)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}
