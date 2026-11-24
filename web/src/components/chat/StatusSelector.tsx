import { useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Eraser, Save } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import { Button } from "../ui/Button";
import {
  SELECTABLE_PRESENCE_STATUSES,
  type PresenceStatus,
} from "../ui/presence";
import { PresenceDot } from "./PresenceDot";

const NOTE_MAX_CHARS = 120;

export interface StatusSelectorProps {
  status: PresenceStatus;
  /** Recado atual (até 120 chars, expira em 8 h — §3/§8.3). */
  note?: string;
  onStatusChange: (status: PresenceStatus) => void;
  /** Dispara ao "Definir recado" (texto) ou "Limpar recado" (vazio). */
  onNoteChange: (note: string) => void;
  /** Gatilho customizado; padrão é o cartão avatar + chevron. */
  trigger?: ReactNode;
  busy?: boolean;
}

/**
 * Seletor de status (§3/§7): 5 status incluindo "Invisível" + recado de até
 * 120 caracteres com contador e aviso de expiração em 8 h.
 * Popover (não Menu) porque o recado exige um textarea — menu Radix não aceita
 * campos de texto; o teclado continua funcional e Esc fecha.
 */
export function StatusSelector({
  status,
  note = "",
  onStatusChange,
  onNoteChange,
  trigger,
  busy = false,
}: StatusSelectorProps) {
  const t = useI18n();
  const [draft, setDraft] = useState<string>(note);

  return (
    <PopoverPrimitive.Root onOpenChange={() => setDraft(note)}>
      <PopoverPrimitive.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            disabled={busy}
            aria-label={t.chat.statusSelector.triggerLabel}
            className="tz-colors flex min-h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            <PresenceDot status={status} />
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="text-[var(--text-3)]" />
          </button>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-[60] w-[280px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-2 shadow-[var(--shadow-2)]"
          style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
        >
          <ul className="flex flex-col" role="list">
            {SELECTABLE_PRESENCE_STATUSES.map((option) => (
              <li key={option} role="listitem">
                <button
                  type="button"
                  onClick={() => onStatusChange(option)}
                  aria-current={status === option ? "true" : undefined}
                  className={`tz-colors flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-list)] hover:bg-[var(--bg-hover)] ${
                    status === option ? "font-medium text-[var(--text)]" : "text-[var(--text-2)]"
                  }`}
                >
                  <PresenceDot status={option} size={8} ringColor="var(--bg-surface)" />
                  <span className="flex-1 text-left">{t.status[option]}</span>
                  {status === option && (
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[var(--radius-full)] bg-[var(--accent)]" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="my-1 h-px bg-[var(--border)]" />
          <div className="flex flex-col gap-1.5 p-1">
            <label
              htmlFor="status-selector-note"
              className="text-[length:var(--fs-meta)] font-medium text-[var(--text-2)]"
            >
              {t.chat.statusSelector.recadoLabel}
            </label>
            <textarea
              id="status-selector-note"
              value={draft}
              maxLength={NOTE_MAX_CHARS}
              placeholder={t.chat.statusSelector.recadoPlaceholder}
              rows={2}
              onChange={(event) => setDraft(event.target.value.slice(0, NOTE_MAX_CHARS))}
              className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[length:var(--fs-list)] leading-[var(--lh-body)] text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
            />
            <div className="flex items-center justify-between">
              <span className="nums-tabular text-[length:var(--fs-meta)] text-[var(--text-3)]">
                {interpolate(t.chat.statusSelector.recadoCounter, { count: draft.length })}
              </span>
              <span className="text-[length:var(--fs-meta)] text-[var(--text-3)]">
                {t.chat.statusSelector.recadoExpires}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<Eraser size={14} strokeWidth={2} />}
                disabled={busy}
                onClick={() => {
                  setDraft("");
                  onNoteChange("");
                }}
              >
                {t.chat.statusSelector.recadoClear}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Save size={14} strokeWidth={2} />}
                disabled={busy || draft === note}
                onClick={() => onNoteChange(draft)}
              >
                {t.chat.statusSelector.recadoSet}
              </Button>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
