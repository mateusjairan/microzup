import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Hash, Loader, MessageSquare } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import { Avatar } from "../ui/Avatar";
import type { PresenceStatus } from "../ui/presence";

export interface CommandItem {
  id: string;
  kind: "conversation" | "person" | "message";
  /** Conversa/pessoa: nome. Mensagem: remetente. */
  title: string;
  /** Mensagem: trecho. Pessoa: setor/recado. Conversa: descrição. */
  subtitle?: string;
  presence?: PresenceStatus;
  avatarUrl?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  conversations: CommandItem[];
  people: CommandItem[];
  messages: CommandItem[];
  /** Grupo "Mensagens" substituído por busca local na conversa ativa (Ctrl+F). */
  conversationItems?: CommandItem[];
  loading?: boolean;
  errorMessage?: string | null;
  /** Ctrl+N: pessoas primeiro. */
  preferredGroup?: "people";
  /** Rótulo do grupo de mensagens (default: "Mensagens"; ex.: Ctrl+F usa "nesta conversa"). */
  messagesGroupLabel?: string;
  onOpenResult: (item: CommandItem) => void;
}

interface HighlightSegment {
  text: string;
  match: boolean;
}

function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let found = haystack.indexOf(needle, cursor);
  while (found >= 0) {
    if (found > cursor) segments.push({ text: text.slice(cursor, found), match: false });
    segments.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => highlightSegments(text, query), [text, query]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="nums-tabular rounded-[2px] bg-[var(--accent-soft)] px-0.5 text-[var(--accent)]"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Palette global (§8.7): grupos Conversas / Pessoas / Mensagens, navegação
 * ↑/↓ + Enter, destaque do termo, estados vazio/carregando/erro.
 * O filtro local das conversas/pessoas e o debounce das mensagens são do
 * chamador (SearchField/props).
 */
export function CommandPalette({
  open,
  onClose,
  query,
  onQueryChange,
  conversations,
  people,
  messages,
  conversationItems,
  loading = false,
  errorMessage = null,
  preferredGroup,
  messagesGroupLabel,
  onOpenResult,
}: CommandPaletteProps) {
  const t = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxIdRef = useRef(`mz-palette-${Math.random().toString(36).slice(2, 8)}`);

  const groups = useMemo(() => {
    const conversationGroupItems = conversationItems ?? messages;
    const messageGroupLabel = messagesGroupLabel ?? t.chat.search.groups.messages;
    const result: Array<{ label: string; items: CommandItem[] }> = [];
    const pushConversationGroup = (): void => {
      if (conversations.length > 0) {
        result.push({ label: t.chat.search.groups.conversations, items: conversations });
      }
    };
    const pushPeopleGroup = (): void => {
      if (people.length > 0) {
        result.push({ label: t.chat.search.groups.people, items: people });
      }
    };
    const pushMessageGroup = (): void => {
      if (conversationGroupItems.length > 0) {
        result.push({ label: messageGroupLabel, items: conversationGroupItems });
      }
    };
    if (preferredGroup === "people") {
      pushPeopleGroup();
      pushConversationGroup();
      pushMessageGroup();
    } else {
      pushConversationGroup();
      pushPeopleGroup();
      pushMessageGroup();
    }
    return result;
  }, [conversations, people, messages, conversationItems, preferredGroup, messagesGroupLabel, t]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex > flat.length - 1) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  const select = (item: CommandItem | undefined) => {
    if (!item) return;
    onOpenResult(item);
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(flat.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(flat[activeIndex]);
    }
  };

  const totalBefore = (groupIndex: number): number =>
    groups.slice(0, groupIndex).reduce((sum, group) => sum + group.items.length, 0);

  const hasEmptyList = flat.length === 0;
  const listboxId = listboxIdRef.current;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[70] bg-[var(--overlay-scrim)]"
          style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
        />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-[70] flex max-h-[70vh] w-[calc(100vw-var(--space-6))] max-w-[560px] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-3)]"
          style={{ animation: "mz-fade-in var(--motion-fast) var(--ease) both" }}
        >
          <DialogPrimitive.Title className="sr-only">{t.nav.searchPlaceholder}</DialogPrimitive.Title>
          <div className="border-b border-[var(--border)] p-2">
            <input
              type="text"
              value={query}
              autoFocus
              placeholder={t.nav.searchPlaceholder}
              aria-label={t.nav.searchPlaceholder}
              aria-controls={listboxId}
              aria-activedescendant={flat.length > 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleKeyDown}
              className="h-10 w-full rounded-[var(--radius-sm)] bg-[var(--bg-app)] px-3 text-[length:var(--fs-body)] text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
            />
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label={t.nav.searchPlaceholder}
            className="min-h-0 flex-1 overflow-y-auto py-1"
          >
            {errorMessage && (
              <p role="alert" className="px-3 py-2 text-[length:var(--fs-list)] text-[var(--danger)]">
                {t.chat.search.error}
              </p>
            )}
            {groups.map((group, groupIndex) => (
              <div key={group.label}>
                <p className="px-3 pb-1 pt-2 text-[length:var(--fs-meta)] font-semibold tracking-wide text-[var(--text-3)] uppercase">
                  {group.label}
                </p>
                {group.items.map((item, itemIndex) => {
                  const flatIndex = totalBefore(groupIndex) + itemIndex;
                  const isActive = flatIndex === activeIndex;
                  return (
                    <button
                      key={item.id}
                      id={`${listboxId}-opt-${flatIndex}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => setActiveIndex(flatIndex)}
                      onClick={() => select(item)}
                      className={`tz-colors flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left ${
                        isActive ? "bg-[var(--bg-hover)]" : ""
                      }`}
                    >
                      {item.kind === "conversation" && (
                        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]">
                          <Hash size={14} strokeWidth={2} />
                        </span>
                      )}
                      {item.kind === "person" && (
                        <Avatar name={item.title} src={item.avatarUrl} size={24} presence={item.presence} />
                      )}
                      {item.kind === "message" && (
                        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-hover)] text-[var(--text-2)]">
                          <MessageSquare size={14} strokeWidth={2} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[length:var(--fs-list)] font-medium text-[var(--text)]">
                          <Highlight text={item.title} query={query} />
                        </span>
                        {item.subtitle && (
                          <span className="block truncate text-[length:var(--fs-meta)] text-[var(--text-3)]">
                            <Highlight text={item.subtitle} query={query} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {loading && (
              <p role="status" className="flex items-center gap-2 px-3 py-2 text-[length:var(--fs-list)] text-[var(--text-3)]">
                <Loader size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                {t.chat.search.loading}
              </p>
            )}
            {hasEmptyList && !loading && !errorMessage && (
              <p className="px-3 py-6 text-center text-[length:var(--fs-list)] text-[var(--text-3)]">
                {query.trim().length === 0 ? t.chat.search.noInput : interpolate(t.chat.search.empty, { query: query.trim() })}
              </p>
            )}
          </div>

          <div className="border-t border-[var(--border)] px-3 py-2">
            <p className="text-[length:var(--fs-meta)] text-[var(--text-3)]">{t.chat.search.hint}</p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
