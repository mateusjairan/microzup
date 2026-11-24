import {
  useEffect,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Bell, Paperclip, Send } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import { IconButton } from "../ui/Button";
import { AttachmentTray } from "./AttachmentTray";
import { CURATED_EMOJIS } from "./emoji";
import type { PendingAttachment } from "./types";

const DEFAULT_MAX_LENGTH = 8_000;
const DEFAULT_COUNTER_FROM = 7_500;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter ou botão enviar. No modo edição, salva a edição (mesmo callback). */
  onSend: (text: string) => void;
  /** Botão clipe (o atalho Ctrl+O é global — ShortcutsProvider). */
  onAttach?: () => void;
  /** "Chamar atenção" (§8.4): o chamador controla a cota de 1×/5 min. */
  onNudge?: () => void;
  canNudge?: boolean;
  pendingAttachments?: PendingAttachment[];
  onRemoveAttachment?: (id: string) => void;
  onCancelUpload?: (id: string) => void;
  onRetryUpload?: (id: string) => void;
  /** Sinal externo de arrastar-e-soltar sobre a janela (visual do §8.6). */
  isDragActive?: boolean;
  onFilesDropped?: (files: File[]) => void;
  /** Colagem de arquivo do clipboard (Ctrl+V). */
  onFilesPasted?: (files: File[]) => void;
  /** Modo edição da última mensagem (↑ no vazio — atalho global decide). */
  editing?: boolean;
  onCancelEdit?: () => void;
  /** Somente leitura (§9 conversa arquivada): desabilita com explicação. */
  disabledReason?: string;
  maxLength?: number;
  counterFrom?: number;
  className?: string;
}

function filesFromDataTransfer(files: FileList | null): File[] {
  if (files === null) return [];
  return Array.from(files);
}

/**
 * Composer (§4/§8/§9): textarea auto-expande, Enter envia / Shift+Enter quebra,
 * contador a partir de 7.500 de 8.000, botões de anexo, 48 emojis ESTÁTICOS
 * curados e "chamar atenção". Drag-drop/colagem chegam por props; o atalho
 * ↑-no-vazio pertence ao ShortcutsProvider (não capturado aqui).
 */
export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  onNudge,
  canNudge = true,
  pendingAttachments,
  onRemoveAttachment,
  onCancelUpload,
  onRetryUpload,
  isDragActive = false,
  onFilesDropped,
  onFilesPasted,
  editing = false,
  onCancelEdit,
  disabledReason,
  maxLength = DEFAULT_MAX_LENGTH,
  counterFrom = DEFAULT_COUNTER_FROM,
  className,
}: ComposerProps) {
  const t = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const disabled = Boolean(disabledReason);
  const showCounter = value.length >= counterFrom;
  const canSend = !disabled && value.trim().length > 0;

  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    onChange("");
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && editing) {
      event.stopPropagation();
      onCancelEdit?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!onFilesPasted) return;
    const files = filesFromDataTransfer(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    onFilesPasted(files);
  };

  const handleDrop = (event: ReactDragEvent<HTMLTextAreaElement>) => {
    if (!onFilesDropped) return;
    const files = filesFromDataTransfer(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    onFilesDropped(files);
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    if (element === null) {
      onChange(value + emoji);
      return;
    }
    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? start;
    onChange(value.slice(0, start) + emoji + value.slice(end));
    requestAnimationFrame(() => {
      element.focus();
      const position = start + emoji.length;
      element.setSelectionRange(position, position);
    });
  };

  return (
    <div
      className={`flex shrink-0 flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg-surface)] p-2 ${className ?? ""}`}
    >
      <AttachmentTray
        items={pendingAttachments ?? []}
        onRemove={onRemoveAttachment}
        onCancel={onCancelUpload}
        onRetry={onRetryUpload}
      />
      <div className="relative">
        {isDragActive && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)] text-[length:var(--fs-body)] font-medium text-[var(--accent)]"
          >
            {t.chat.composer.dropHint}
          </div>
        )}
        <div className="flex items-end gap-1">
          <IconButton
            label={t.chat.composer.attach}
            disabled={disabled || !onAttach}
            onClick={onAttach}
          >
            <Paperclip size={16} strokeWidth={2} />
          </IconButton>
          <PopoverPrimitive.Root>
            <PopoverPrimitive.Trigger asChild>
              <IconButton label={t.chat.composer.emoji} disabled={disabled}>
                <span aria-hidden="true" className="text-[length:var(--fs-body)] leading-none">
                  🙂
                </span>
              </IconButton>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                align="start"
                sideOffset={4}
                aria-label={t.chat.composer.emojiTitle}
                className="z-[60] grid w-[264px] grid-cols-8 gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-2)]"
                style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
              >
                {CURATED_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emoji}
                    onClick={() => insertEmoji(emoji)}
                    className="tz-colors flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[length:var(--fs-body)] leading-none hover:bg-[var(--bg-hover)]"
                  >
                    {emoji}
                  </button>
                ))}
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
          <textarea
            ref={textareaRef}
            value={value}
            disabled={disabled}
            maxLength={maxLength}
            aria-label={t.conversation.placeholder}
            placeholder={disabled ? disabledReason : t.conversation.placeholder}
            rows={1}
            onKeyDown={handleKeyDown}
            onChange={(event) => onChange(event.target.value)}
            onPaste={handlePaste}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="max-h-36 min-h-9 flex-1 resize-none overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2 text-[length:var(--fs-body)] leading-[var(--lh-body)] text-[var(--text)] outline-none placeholder:text-[var(--text-3)] disabled:cursor-not-allowed disabled:bg-[var(--bg-hover)] disabled:opacity-70"
          />
          <IconButton
            label={t.conversation.send}
            disabled={!canSend}
            onClick={submit}
            className="text-[var(--accent)]"
          >
            <Send size={16} strokeWidth={2} />
          </IconButton>
          {onNudge && (
            <IconButton
              label={t.chat.composer.nudge}
              disabled={disabled || !canNudge}
              onClick={onNudge}
              className="text-[var(--text-3)]"
            >
              <Bell size={16} strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="flex min-h-4 items-center justify-between gap-2 px-1">
        <span className="truncate text-[length:var(--fs-meta)] text-[var(--text-3)]">
          {editing ? `${t.chat.composer.editing} · ${t.chat.composer.editingHint}` : t.chat.composer.sendHint}
          {disabledReason && !editing ? ` · ${disabledReason}` : ""}
        </span>
        {showCounter && (
          <span
            className={`nums-tabular shrink-0 text-[length:var(--fs-meta)] ${
              value.length >= maxLength ? "text-[var(--danger)]" : "text-[var(--text-3)]"
            }`}
            aria-live="polite"
          >
            {interpolate(t.chat.composer.counter, { used: value.length, max: maxLength })}
          </span>
        )}
      </div>
    </div>
  );
}
