import { useEffect, useRef } from "react";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";

export type ToastKind = "info" | "success" | "error";

export interface ToastItemData {
  id: string;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-fecho em ms; ausência de valor mantém o toast até o usuário fechar. */
  durationMs?: number;
}

export interface ToastItemProps {
  toast: ToastItemData;
  onDismiss: (id: string) => void;
}

const KIND_ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CircleCheck,
  error: CircleX,
};

const KIND_COLOR: Record<ToastKind, string> = {
  info: "var(--accent)",
  success: "var(--success)",
  error: "var(--danger)",
};

function defaultDuration(kind: ToastKind): number {
  return kind === "error" ? 8000 : 6000;
}

/** Toast único (§8.5): info/sucesso/erro/ação. Erro anuncia como alerta. */
export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const t = useI18n();
  const Icon = KIND_ICON[toast.kind];
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(toast.durationMs ?? defaultDuration(toast.kind));
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    const duration = toast.durationMs ?? defaultDuration(toast.kind);
    if (duration <= 0) return;
    remainingRef.current = duration;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => onDismiss(toast.id), duration);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.durationMs, toast.kind, onDismiss]);

  const pause = (): void => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startedAtRef.current),
    );
  };

  const resume = (): void => {
    if (timerRef.current !== null) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => onDismiss(toast.id),
      Math.max(remainingRef.current, 0),
    );
  };

  const runAction = (): void => {
    toast.onAction?.();
    onDismiss(toast.id);
  };

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className="pointer-events-auto flex w-[var(--toast-width)] max-w-full items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-[length:var(--fs-body)] shadow-[var(--shadow-2)]"
      style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
    >
      <span aria-hidden="true" style={{ color: KIND_COLOR[toast.kind] }} className="mt-0.5 shrink-0">
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 leading-[var(--lh-body)] break-words">{toast.message}</div>
      {toast.actionLabel && (
        <button
          type="button"
          onClick={runAction}
          className="flex h-8 shrink-0 items-center rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-meta)] font-medium text-[var(--accent)] hover:bg-[var(--bg-hover)]"
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t.ui.close}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

export interface ToastViewportProps {
  toasts: ToastItemData[];
  onDismiss: (id: string) => void;
}

/** Canto inferior direito (perto da bandeja). Sem toasts → sem região no DOM. */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const t = useI18n();
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label={t.ui.notifications}
      className="pointer-events-none fixed bottom-0 right-0 z-[80] flex flex-col gap-2 p-4"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
