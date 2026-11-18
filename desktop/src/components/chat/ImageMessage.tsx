import { CircleX, Loader } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import type { ChatAttachment } from "./types";

export interface ImageMessageProps {
  attachment: ChatAttachment;
  /** Legenda abaixo da miniatura (ex.: "lote-22.png · 2,1 MB" — chamador formata). */
  caption?: string;
  /** Abre o lightbox (o chamador controla qual imagem e índice). */
  onOpen?: (attachment: ChatAttachment) => void;
  onRetryUpload?: (attachment: ChatAttachment) => void;
  className?: string;
}

/**
 * Imagem em mensagem (§7/§8.6): miniatura em até 480 px (token), clique/Enter
 * abre o lightbox. Upload mostra placeholder com progresso; remoção mostra
 * "arquivo indisponível" (§9).
 */
export function ImageMessage({
  attachment,
  caption,
  onOpen,
  onRetryUpload,
  className,
}: ImageMessageProps) {
  const t = useI18n();
  const uploading = attachment.state === "uploading";
  const errored = attachment.state === "error";
  const unavailable = attachment.state === "unavailable";
  const src = attachment.thumbnailUrl ?? attachment.url;

  if (uploading) {
    const progress = attachment.progress ?? 0;
    return (
      <figure className={`flex flex-col gap-1 ${className ?? ""}`}>
        <div
          className="flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-hover)]"
          style={{ height: "var(--image-thumb-height)", width: "min(var(--image-thumb-max), 100%)" }}
        >
          <div className="flex flex-col items-center gap-2 text-[var(--text-3)]">
            <Loader size={20} strokeWidth={2} className="animate-spin" aria-hidden="true" />
            <span className="nums-tabular text-[length:var(--fs-meta)]">{progress}%</span>
          </div>
        </div>
      </figure>
    );
  }

  if (errored) {
    return (
      <figure className={`flex flex-col gap-1 ${className ?? ""}`}>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--bg-surface)] text-[var(--danger)]"
          style={{ height: "var(--image-thumb-height)", width: "min(var(--image-thumb-max), 100%)" }}
        >
          <CircleX size={20} strokeWidth={2} aria-hidden="true" />
          <span className="text-[length:var(--fs-list)]">{t.chat.message.failed}</span>
          {onRetryUpload && (
            <button
              type="button"
              onClick={() => onRetryUpload(attachment)}
              className="tz-colors flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--border)] px-3 text-[length:var(--fs-meta)] font-medium text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
            >
              {t.chat.files.retryUpload}
            </button>
          )}
        </div>
      </figure>
    );
  }

  if (unavailable || !src) {
    return (
      <figure className={`flex flex-col gap-1 ${className ?? ""}`}>
        <div
          className="flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-hover)] text-[length:var(--fs-list)] text-[var(--text-3)]"
          style={{ height: "var(--image-thumb-height)", width: "min(var(--image-thumb-max), 100%)" }}
        >
          {t.chat.files.unavailable}
        </div>
      </figure>
    );
  }

  const open = (): void => onOpen?.(attachment);

  return (
    <figure className={`flex flex-col gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={open}
        className="tz-colors block max-w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] hover:border-[var(--accent)]"
        style={{ width: "fit-content" }}
      >
        <img
          src={src}
          alt={attachment.filename}
          className="block h-auto max-w-full rounded-[var(--radius-md)]"
          style={{
            maxWidth: "var(--image-thumb-max)",
            maxHeight: "var(--image-thumb-height)",
            objectFit: "contain",
          }}
          loading="lazy"
        />
      </button>
      {caption && (
        <figcaption className="nums-tabular text-[length:var(--fs-meta)] text-[var(--text-3)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
