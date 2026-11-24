import { Clock, CircleX, Ellipsis, PenLine, Trash } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { formatClock, formatDateTime, interpolate } from "../utils/format";
import { Avatar } from "../ui/Avatar";
import { Dropdown, DropdownItem, DropdownSeparator } from "../ui/Dropdown";
import { Tooltip } from "../ui/Tooltip";
import { FileCard } from "./FileCard";
import { ImageMessage } from "./ImageMessage";
import type { ChatAttachment, ChatMessage } from "./types";

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Mensagem do próprio usuário (alinhamento à direita, bolha accent-soft). */
  isOwn: boolean;
  /** Agrupada à anterior do mesmo autor (janela de 5 min) — sem cabeçalho. */
  grouped?: boolean;
  onRetry?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onOpenImage?: (attachment: ChatAttachment, message: ChatMessage) => void;
  onDownloadFile?: (attachment: ChatAttachment, message: ChatMessage) => void;
  /** Progresso de download por attachmentId (§8.6: card mostra progresso). */
  downloadProgressByAttachment?: Record<string, number>;
  className?: string;
}

/**
 * Bolha de mensagem (§8.1): recebida/própria/agrupada · sending 60% com
 * relógio · sent · failed com "Reenviar" · editada com tooltip da data ·
 * apagada "Mensagem removida" · menu editar/apagar nas próprias.
 */
export function MessageBubble({
  message,
  isOwn,
  grouped = false,
  onRetry,
  onEdit,
  onDelete,
  onOpenImage,
  onDownloadFile,
  downloadProgressByAttachment,
  className,
}: MessageBubbleProps) {
  const t = useI18n();
  const deleted = Boolean(message.deletedAt);
  const sending = message.delivery === "sending" && !deleted;
  const failed = message.delivery === "failed" && !deleted;
  const edited = Boolean(message.editedAt) && !deleted;
  const attachments = message.attachments ?? [];
  const canEdit = isOwn && !deleted && !sending && message.delivery === "sent";
  const canDelete = isOwn && !deleted && message.delivery !== "sending";
  const time = formatClock(message.createdAt);

  return (
    <div
      className={`tz-colors flex items-end gap-2 ${isOwn ? "flex-row-reverse" : ""} ${
        grouped ? "mt-0.5" : "mt-3"
      } ${className ?? ""}`}
    >
      {!grouped && !isOwn && (
        <Avatar name={message.senderName} src={message.senderAvatarUrl} size={20} />
      )}
      <div className={`flex min-w-0 max-w-[75%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
        {!grouped && (
          <div className={`mb-0.5 flex items-center gap-1.5 px-1 ${isOwn ? "flex-row-reverse" : ""}`}>
            {!isOwn && (
              <span className="text-[length:var(--fs-list)] font-semibold text-[var(--text)]">
                {message.senderName}
              </span>
            )}
            <time
              dateTime={message.createdAt}
              className="nums-tabular text-[length:var(--fs-meta)] text-[var(--text-3)]"
            >
              {time}
            </time>
            {edited && (
              <Tooltip label={interpolate(t.chat.message.editedAt, { time: formatDateTime(message.editedAt ?? "") })}>
                <span
                  title={interpolate(t.chat.message.editedAt, { time: formatDateTime(message.editedAt ?? "") })}
                  className="text-[length:var(--fs-meta)] text-[var(--text-3)] italic"
                >
                  ({t.chat.message.edited})
                </span>
              </Tooltip>
            )}
          </div>
        )}

        {deleted ? (
          <p
            className="rounded-[var(--radius-md)] bg-[var(--bg-hover)] px-3 py-1.5 text-[length:var(--fs-list)] text-[var(--text-3)] italic"
            aria-label={`${message.senderName}: ${t.conversation.removed}`}
          >
            {t.conversation.removed}
          </p>
        ) : (
          <>
            {message.body.length > 0 && (
              <div
                className={`whitespace-pre-wrap break-words rounded-[var(--radius-md)] px-3 py-2 text-[length:var(--fs-body)] leading-[var(--lh-body)] ${
                  isOwn
                    ? "bg-[var(--accent-soft)] text-[var(--text)]"
                    : "border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)]"
                } ${sending ? "opacity-60" : ""}`}
              >
                {message.body}
              </div>
            )}
            {attachments.map((attachment) =>
              attachment.kind === "image" ? (
                <ImageMessage
                  key={attachment.id}
                  attachment={attachment}
                  className="mt-1"
                  onOpen={(item) => onOpenImage?.(item, message)}
                />
              ) : (
                <FileCard
                  key={attachment.id}
                  attachment={attachment}
                  className="mt-1"
                  downloadProgress={downloadProgressByAttachment?.[attachment.id]}
                  onDownload={(item) => onDownloadFile?.(item, message)}
                />
              ),
            )}
            {failed && (
              <div className="mt-1 flex items-center gap-2 px-1">
                <CircleX size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--danger)]" />
                <span className="text-[length:var(--fs-meta)] text-[var(--danger)]">
                  {t.chat.message.failed}
                </span>
                {onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(message)}
                    className="tz-colors flex h-6 min-h-6 items-center rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-meta)] font-medium text-[var(--danger)] underline-offset-2 hover:bg-[var(--bg-hover)] hover:underline"
                  >
                    {t.chat.message.resend}
                  </button>
                )}
              </div>
            )}
            {sending && (
              <div className="mt-1 flex items-center gap-1 px-1 text-[var(--text-3)]">
                <Clock size={12} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">{t.ui.sending}</span>
              </div>
            )}
          </>
        )}
      </div>
      {(canEdit || canDelete) && (
        <div className="mb-1 shrink-0">
          <Dropdown
            trigger={
              <button
                type="button"
                aria-label={t.chat.message.menuLabel}
                className="tz-colors flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover/article:opacity-100"
              >
                <Ellipsis size={16} strokeWidth={2} />
              </button>
            }
            align={isOwn ? "end" : "start"}
          >
            {canEdit && (
              <DropdownItem icon={<PenLine size={14} strokeWidth={2} />} onSelect={() => onEdit?.(message)}>
                {t.chat.message.edit}
              </DropdownItem>
            )}
            {canEdit && canDelete && <DropdownSeparator />}
            {canDelete && (
              <DropdownItem danger icon={<Trash size={14} strokeWidth={2} />} onSelect={() => onDelete?.(message)}>
                {t.chat.message.delete}
              </DropdownItem>
            )}
          </Dropdown>
        </div>
      )}
    </div>
  );
}
