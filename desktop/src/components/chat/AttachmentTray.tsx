import { CircleCheck, CircleX, RotateCcw, X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { formatFileSize } from "../utils/format";
import { IconButton } from "../ui/Button";
import { fileIcon } from "./FileCard";
import type { PendingAttachment } from "./types";

export interface AttachmentTrayProps {
  /** Uploads pendentes ANTES de enviar a mensagem (§8.6). */
  items: PendingAttachment[];
  /** Remove da fila (qualquer estado). */
  onRemove?: (id: string) => void;
  /** Cancela um upload em andamento. */
  onCancel?: (id: string) => void;
  /** Repete um upload que falhou. */
  onRetry?: (id: string) => void;
  className?: string;
}

/**
 * Bandeja de anexos pendentes (§8.6): nome, tamanho, progresso por arquivo,
 * cancelar durante o upload, remover antes de enviar e retry em falha.
 */
export function AttachmentTray({ items, onRemove, onCancel, onRetry, className }: AttachmentTrayProps) {
  const t = useI18n();
  if (items.length === 0) return null;

  return (
    <ul
      aria-label={t.chat.composer.trayLabel}
      className={`flex flex-col gap-1 ${className ?? ""}`}
    >
      {items.map((item) => {
        const Icon = fileIcon(undefined, item.filename);
        const uploading = item.state === "uploading";
        const errored = item.state === "error";
        const ready = item.state === "ready";
        const progress = item.progress ?? 0;
        return (
          <li
            key={item.id}
            className="tz-colors flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-2"
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${
                errored
                  ? "bg-[var(--bg-hover)] text-[var(--danger)]"
                  : ready
                    ? "bg-[var(--bg-hover)] text-[var(--success)]"
                    : "bg-[var(--bg-hover)] text-[var(--text-2)]"
              }`}
            >
              {errored ? (
                <CircleX size={14} strokeWidth={2} />
              ) : ready ? (
                <CircleCheck size={14} strokeWidth={2} />
              ) : (
                <Icon size={14} strokeWidth={2} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--fs-list)] text-[var(--text)]">{item.filename}</p>
              <p className="nums-tabular truncate text-[length:var(--fs-meta)] text-[var(--text-3)]">
                {formatFileSize(item.sizeBytes, t.format.units)}
                {uploading ? ` · ${progress}%` : errored ? ` · ${t.chat.message.failed}` : ""}
              </p>
              {uploading && (
                <div
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-0.5 h-1 w-full overflow-hidden rounded-[var(--radius-full)] bg-[var(--border)]"
                >
                  <div
                    className="h-full rounded-[var(--radius-full)] bg-[var(--accent)]"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              )}
            </div>
            {errored && onRetry && (
              <IconButton label={t.chat.files.retryUpload} onClick={() => onRetry(item.id)}>
                <RotateCcw size={14} strokeWidth={2} />
              </IconButton>
            )}
            {uploading && onCancel && (
              <IconButton label={t.chat.files.cancelUpload} onClick={() => onCancel(item.id)}>
                <X size={14} strokeWidth={2} />
              </IconButton>
            )}
            {onRemove && (
              <IconButton label={t.ui.remove} onClick={() => onRemove(item.id)}>
                <X size={14} strokeWidth={2} />
              </IconButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}
