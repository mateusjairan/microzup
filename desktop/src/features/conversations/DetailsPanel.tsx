import { Download, Image as ImageIcon, X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { formatFileSize } from "../../components/utils/format";
import { Avatar, IconButton } from "../../components/ui";
import { fileIcon } from "../../components/chat";
import type { ChatAttachment } from "../../components/chat";
import type { PresenceStatus } from "../../components/ui/presence";

export interface DetailsMember {
  id: string;
  name: string;
  presence?: PresenceStatus;
  inactive?: boolean;
}

export interface DetailsPanelProps {
  title: string;
  members: DetailsMember[];
  attachments: ChatAttachment[];
  archived?: boolean;
  onDownload: (attachment: ChatAttachment) => void;
  onOpenImage: (attachment: ChatAttachment) => void;
  onClose: () => void;
}

/** Painel de detalhes (§4): membros com presença + arquivos compartilhados. */
export function DetailsPanel({
  title,
  members,
  attachments,
  archived = false,
  onDownload,
  onOpenImage,
  onClose,
}: DetailsPanelProps) {
  const t = useI18n();

  return (
    <aside
      className="flex w-[var(--details-width)] shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-surface)]"
      aria-label={t.details.title}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <h2 className="min-w-0 flex-1 truncate text-[length:var(--fs-panel)] font-semibold leading-[var(--lh-title)] text-[var(--text)]">
          {title}
        </h2>
        <IconButton label={t.details.close} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </IconButton>
      </header>

      {archived && (
        <p className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-[length:var(--fs-meta)] text-[var(--text-3)] italic">
          {t.details.archivedNote}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section aria-label={t.details.membersCount}>
          <h3 className="flex items-center justify-between px-3 pb-1 pt-3 text-[length:var(--fs-meta)] font-semibold tracking-wide text-[var(--text-3)] uppercase">
            <span>{t.conversation.members}</span>
            <span className="nums-tabular">{members.length}</span>
          </h3>
          {members.length === 0 ? (
            <p className="px-3 py-2 text-[length:var(--fs-list)] text-[var(--text-3)]">
              {t.details.membersEmpty}
            </p>
          ) : (
            members.map((member) => (
              <div
                key={member.id}
                className={`flex h-8 items-center gap-2 px-3 ${member.inactive ? "opacity-60" : ""}`}
              >
                <Avatar name={member.name} size={20} presence={member.presence} />
                <span className="min-w-0 flex-1 truncate text-[length:var(--fs-list)] text-[var(--text)]">
                  {member.name}
                </span>
                {member.presence !== undefined && (
                  <span className="shrink-0 text-[length:var(--fs-meta)] text-[var(--text-3)]">
                    {member.inactive ? t.chat.contact.inactive : t.status[member.presence]}
                  </span>
                )}
              </div>
            ))
          )}
        </section>

        <section aria-label={t.details.filesCount} className="mt-3">
          <h3 className="flex items-center justify-between px-3 pb-1 pt-2 text-[length:var(--fs-meta)] font-semibold tracking-wide text-[var(--text-3)] uppercase">
            <span>{t.conversation.files}</span>
            <span className="nums-tabular">{attachments.length}</span>
          </h3>
          {attachments.length === 0 ? (
            <p className="px-3 py-2 text-[length:var(--fs-list)] text-[var(--text-3)]">
              {t.details.filesEmpty}
            </p>
          ) : (
            attachments.map((attachment) => {
              const Icon = attachment.kind === "image" ? ImageIcon : fileIcon(attachment.mimeType, attachment.filename);
              return (
                <div
                  key={attachment.id}
                  className="tz-colors flex h-10 items-center gap-2 px-3 hover:bg-[var(--bg-hover)]"
                >
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-hover)] text-[var(--text-2)]">
                    <Icon size={14} strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--fs-list)] text-[var(--text)]">
                      {attachment.filename}
                    </span>
                    <span className="nums-tabular block truncate text-[length:var(--fs-meta)] text-[var(--text-3)]">
                      {formatFileSize(attachment.sizeBytes, t.format.units)}
                    </span>
                  </span>
                  {attachment.kind === "image" ? (
                    <IconButton label={t.chat.lightbox.download} onClick={() => onOpenImage(attachment)}>
                      <ImageIcon size={14} strokeWidth={2} />
                    </IconButton>
                  ) : (
                    <IconButton label={t.ui.download} onClick={() => onDownload(attachment)}>
                      <Download size={14} strokeWidth={2} />
                    </IconButton>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>
    </aside>
  );
}
