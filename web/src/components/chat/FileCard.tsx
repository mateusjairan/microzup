import { CircleX, Download, File, FileArchive, FileImage, FileSpreadsheet, FileText, Loader, X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { formatFileSize, interpolate } from "../utils/format";
import { IconButton } from "../ui/Button";
import type { ChatAttachment } from "./types";

export interface FileCardProps {
  attachment: ChatAttachment;
  /** Progresso de download (0–100) quando o download está em curso (§8.6). */
  downloadProgress?: number;
  onDownload?: (attachment: ChatAttachment) => void;
  onCancelUpload?: (attachment: ChatAttachment) => void;
  onRetryUpload?: (attachment: ChatAttachment) => void;
  className?: string;
}

/** Ícone por tipo de arquivo (mime/extension) — reusado pelo AttachmentTray. */
export function fileIcon(mimeType: string | undefined, filename: string): typeof File {
  const lower = filename.toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return FileImage;
  if (mime.includes("pdf") || lower.endsWith(".pdf")) return FileText;
  if (mime.includes("spreadsheet") || /\.(xlsx?|csv|ods)$/.test(lower)) return FileSpreadsheet;
  if (mime.includes("zip") || /\.(zip|7z|rar|gz|tar)$/.test(lower)) return FileArchive;
  if (mime.startsWith("text/") || /\.(txt|md|log|json|xml)$/.test(lower)) return FileText;
  return File;
}

/**
 * Card de arquivo (§7/§8.6): ícone por tipo, nome, tamanho, progresso,
 * falha com retry e download. "Arquivo indisponível" quando removido (§9).
 */
export function FileCard({
  attachment,
  downloadProgress,
  onDownload,
  onCancelUpload,
  onRetryUpload,
  className,
}: FileCardProps) {
  const t = useI18n();
  const Icon = fileIcon(attachment.mimeType, attachment.filename);
  const sizeLabel = formatFileSize(attachment.sizeBytes, t.format.units);
  const uploading = attachment.state === "uploading";
  const errored = attachment.state === "error";
  const unavailable = attachment.state === "unavailable";
  const downloading = typeof downloadProgress === "number" && downloadProgress >= 0 && downloadProgress < 100;
  const progress = attachment.progress ?? downloadProgress ?? 0;

  return (
    <div
      className={`tz-colors flex h-12 w-[var(--filecard-width)] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 ${unavailable ? "opacity-70" : ""} ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-hover)] text-[var(--text-2)]"
      >
        {unavailable ? <File size={16} strokeWidth={2} /> : <Icon size={16} strokeWidth={2} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[length:var(--fs-list)] font-medium text-[var(--text)]">
          {attachment.filename}
        </p>
        <p className="nums-tabular truncate text-[length:var(--fs-meta)] text-[var(--text-3)]">
          {unavailable
            ? t.chat.files.unavailable
            : errored
              ? t.chat.message.failed
              : uploading
                ? `${sizeLabel} · ${progress}%`
                : downloading
                  ? interpolate(t.chat.files.downloadProgress, { percent: progress })
                  : sizeLabel}
        </p>
        {(uploading || downloading) && (
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
      {uploading && onCancelUpload && (
        <IconButton label={t.chat.files.cancelUpload} onClick={() => onCancelUpload(attachment)}>
          <X size={16} strokeWidth={2} />
        </IconButton>
      )}
      {uploading && !onCancelUpload && (
        <Loader size={16} strokeWidth={2} className="animate-spin text-[var(--text-3)]" aria-hidden="true" />
      )}
      {errored && onRetryUpload && (
        <button
          type="button"
          onClick={() => onRetryUpload(attachment)}
          className="tz-colors flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-meta)] font-medium text-[var(--danger)] hover:bg-[var(--bg-hover)]"
        >
          <CircleX size={14} strokeWidth={2} aria-hidden="true" />
          {t.chat.files.retryUpload}
        </button>
      )}
      {attachment.state === "ready" && onDownload && !downloading && (
        <IconButton label={t.ui.download} onClick={() => onDownload(attachment)}>
          <Download size={16} strokeWidth={2} />
        </IconButton>
      )}
    </div>
  );
}
