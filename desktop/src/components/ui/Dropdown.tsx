import type { ReactNode } from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";

export interface DropdownProps {
  /** Elemento que dispara (deve aceitar ref — use asChild interno). */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  sideOffset?: number;
  contentClassName?: string;
}

/** Dropdown Radix (§7): foco preso, Esc fecha, teclado nativo. */
export function Dropdown({
  trigger,
  children,
  align = "start",
  side = "bottom",
  sideOffset = 4,
  contentClassName,
}: DropdownProps) {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={`z-[60] min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-2)] ${contentClassName ?? ""}`}
          style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
        >
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export interface DropdownItemProps {
  icon?: ReactNode;
  danger?: boolean;
  /** Marca de seleção à direita (ex.: status atual). */
  checked?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}

export function DropdownItem({
  icon,
  danger = false,
  checked = false,
  disabled = false,
  onSelect,
  children,
}: DropdownItemProps) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={() => onSelect?.()}
      className={`tz-colors flex min-h-8 cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[length:var(--fs-list)] outline-none data-[highlighted]:bg-[var(--bg-hover)] ${
        danger ? "text-[var(--danger)]" : "text-[var(--text)]"
      } data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60`}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-[var(--text-3)]">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      {checked && (
        <Check size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
      )}
    </DropdownPrimitive.Item>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2 py-1.5 text-[length:var(--fs-meta)] text-[var(--text-3)]">
      {children}
    </DropdownPrimitive.Label>
  );
}

export function DropdownSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-[var(--border)]" />;
}
