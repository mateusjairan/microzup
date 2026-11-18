import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Título acessível (Radix exige DialogTitle; required na prática). */
  title: string;
  description?: string;
  children: ReactNode;
  /** Rodapé com ações (botões). */
  footer?: ReactNode;
  size?: "sm" | "md";
  /** Botão "X" no canto (padrão true). */
  showClose?: boolean;
  contentClassName?: string;
}

const SIZE_CLASS = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
} as const;

/**
 * Dialog Radix (§7): foco preso, Esc fecha, overlay com corte seco em
 * reduced-motion. Título e descrição são DialogTitle/Description nativos.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  showClose = true,
  contentClassName,
}: DialogProps) {
  const t = useI18n();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[70] bg-[var(--overlay-scrim)]"
          style={{ animation: "mz-fade-in var(--motion-modal) var(--ease) both" }}
        />
        <DialogPrimitive.Content
          className={`fixed left-1/2 top-1/2 z-[70] flex max-h-[85vh] w-[calc(100vw-var(--space-6))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-3)] ${SIZE_CLASS[size]} ${contentClassName ?? ""}`}
          style={{ animation: "mz-fade-in var(--motion-modal) var(--ease) both" }}
        >
          <div className="flex items-start gap-3 p-4 pb-2">
            <DialogPrimitive.Title className="flex-1 text-[length:var(--fs-panel)] font-semibold leading-[var(--lh-title)] text-[var(--text)]">
              {title}
            </DialogPrimitive.Title>
            {showClose && (
              <DialogPrimitive.Close
                aria-label={t.ui.close}
                className="tz-colors flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                <X size={16} strokeWidth={2} />
              </DialogPrimitive.Close>
            )}
          </div>
          {description && (
            <DialogPrimitive.Description className="px-4 pb-2 text-[length:var(--fs-body)] leading-[var(--lh-body)] text-[var(--text-2)]">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] p-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
