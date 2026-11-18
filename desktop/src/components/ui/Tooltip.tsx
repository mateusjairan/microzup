import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export interface TooltipProps {
  /** Texto do tooltip (já traduzido pelo chamador via i18n). */
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Atraso em ms (padrão Radix 700 ms é lento demais para dica de horário). */
  delayMs?: number;
}

/** Tooltip Radix (§7) — inclui o próprio Provider; foco também dispara. */
export function Tooltip({ label, children, side = "top", delayMs = 300 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayMs}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-[90] rounded-[var(--radius-sm)] bg-[var(--text)] px-2 py-1 text-[length:var(--fs-meta)] leading-[var(--lh-body)] text-[var(--bg-surface)] shadow-[var(--shadow-1)]"
            style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
