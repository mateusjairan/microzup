import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Virtuoso, type ListRange, type ListProps, type ScrollerProps, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown, Inbox, Loader } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import { useReducedMotion } from "../utils/useReducedMotion";
import { EmptyState } from "../ui/EmptyState";
import { buildFlagIndex, NO_ITEM_FLAGS, type ItemFlags } from "../../features/messages/itemFlags";
import { DayDivider } from "./DayDivider";
import { MessageAnnouncer } from "./MessageAnnouncer";
import { MessageBubble } from "./MessageBubble";
import { UnreadDivider } from "./UnreadDivider";
import type { ChatAttachment, ChatMessage } from "./types";

export interface MessageListProps {
  messages: ChatMessage[];
  /** Id do usuário atual — define própria (direita) vs recebida (esquerda). */
  currentUserId: string;
  /**
   * Paginação para trás (§8.2): chamado ao atingir o topo. O chamador
   * antecipa `firstItemIndex` (decrementa pelo tamanho da página) para
   * preservar a âncora — o Virtuoso cuida do "sem pulo".
   */
  onLoadOlder?: () => void;
  hasMore?: boolean;
  loadingOlder?: boolean;
  /** Base do Virtuoso para prepend estável (mantenha positivo; ex.: 100.000). */
  firstItemIndex?: number;
  /** seq da primeira não lida: divisor + posição inicial ao abrir (§8.2). */
  unreadSeq?: number | null;
  /** Anúncio aria-live "Nome: texto" (montado pelo chamador, §10). */
  announcement?: string | null;
  /** Rótulo acessível do feed (nome da conversa). */
  feedLabel?: string;
  /** Anexos por messageId — o chamador resolve (fetch autorizado + cache). */
  attachmentsByMessage?: Record<string, ChatAttachment[]>;
  /** Pede os anexos quando a mensagem fica VISÍVEL sem entrada em cache. */
  requestAttachments?: (messageId: string) => void;
  /** Salto de busca (§8.7): rola até a seq e destaca o artigo. */
  highlightSeq?: number | null;
  /** Progresso de download por attachmentId (§8.6, repassado às bolhas). */
  downloadProgressByAttachment?: Record<string, number>;
  onRetry?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onOpenImage?: (attachment: ChatAttachment, message: ChatMessage) => void;
  onDownloadFile?: (attachment: ChatAttachment, message: ChatMessage) => void;
  className?: string;
}

/**
 * Contêineres intermediários do Virtuoso são puramente estruturais —
 * role="presentation" os torna transparentes na árvore de acessibilidade.
 * O SEMÂNTICO role="feed" vive na borda dos artigos (FeedList), porque o
 * padrão ARIA "feed" exige artigos como descendentes diretos e o Virtuoso
 * insere contêineres internos entre o contêiner externo e os itens.
 * O Scroller vira uma região com rótulo e foco de teclado: região rolável
 * acessível por teclado (axe scrollable-region-focusable) e ponto único de
 * entrada na ordem de tabulação da lista.
 */
const FeedScrollerBase = forwardRef<HTMLDivElement, ScrollerProps & React.HTMLAttributes<HTMLDivElement>>(
  function FeedScrollerBase(props, ref) {
    return <div {...props} ref={ref} />;
  },
);

/**
 * Lista de mensagens (§7/§8.2): virtualizada (react-virtuoso), agrupada por
 * autor (janela de 5 min) com divisor de dia e de não-lidas; paginação para
 * trás por callback; colada no fim quando o usuário está no fim, senão pill
 * "N novas mensagens"; navegável por setas sem roubar o foco do composer.
 */
export function MessageList({
  messages,
  currentUserId,
  onLoadOlder,
  hasMore = false,
  loadingOlder = false,
  firstItemIndex,
  unreadSeq = null,
  announcement = null,
  feedLabel,
  attachmentsByMessage,
  requestAttachments,
  highlightSeq = null,
  downloadProgressByAttachment,
  onRetry,
  onEdit,
  onDelete,
  onOpenImage,
  onDownloadFile,
  className,
}: MessageListProps) {
  const t = useI18n();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const lastCountRef = useRef(messages.length);
  const requestedAttachmentsRef = useRef(new Set<string>());
  const [visibleRange, setVisibleRange] = useState<ListRange>({ startIndex: 0, endIndex: 0 });
  const [unseen, setUnseen] = useState(0);

  // Flags por id (não por índice): o Virtuoso entrega o índice ABSOLUTO do
  // `firstItemIndex` e indexar o array por ele zerava o lookup.
  const flagsById = useMemo<Map<string, ItemFlags>>(
    () => buildFlagIndex(messages, unreadSeq),
    [messages, unreadSeq],
  );

  useEffect(() => {
    const previousCount = lastCountRef.current;
    lastCountRef.current = messages.length;
    if (messages.length <= previousCount) return;
    if (atBottomRef.current) {
      setUnseen(0);
    } else {
      setUnseen((count) => count + (messages.length - previousCount));
    }
  }, [messages]);

  // Anexos sob demanda: apenas das mensagens VISÍVEIS (virtualização), uma vez.
  useEffect(() => {
    if (!requestAttachments) return;
    // O Virtuoso reporta rangeChanged no espaço ABSOLUTO (inclui o offset do
    // firstItemIndex usado no prepend estável); `messages` é relativo.
    // Sem deslocar o índice, o loop abaixo nunca roda em conversas maiores
    // que a viewport e os FileCards não carregam.
    const offset = firstItemIndex ?? 0;
    const startIndex = Math.max(0, visibleRange.startIndex - offset);
    const endIndex = Math.min(messages.length - 1, visibleRange.endIndex - offset);
    for (let index = startIndex; index <= endIndex; index += 1) {
      const message = messages[index];
      if (message === undefined) continue;
      if (message.delivery === "sending") continue;
      if (attachmentsByMessage?.[message.id] !== undefined) continue;
      if (requestedAttachmentsRef.current.has(message.id)) continue;
      requestedAttachmentsRef.current.add(message.id);
      requestAttachments(message.id);
    }
  }, [visibleRange, messages, attachmentsByMessage, requestAttachments, firstItemIndex]);

  // Salto de busca (§8.7): rola até a seq destacada.
  useEffect(() => {
    if (highlightSeq === null) return;
    const index = messages.findIndex((message) => message.seq === highlightSeq);
    if (index < 0) return;
    virtuosoRef.current?.scrollToIndex({
      index,
      align: "center",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [highlightSeq, messages, reducedMotion]);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  }, []);

  const handleStartReached = useCallback(() => {
    if (hasMore && !loadingOlder) onLoadOlder?.();
  }, [hasMore, loadingOlder, onLoadOlder]);

  const followOutput = useCallback(
    (isAtBottom: boolean): "auto" | "smooth" | boolean =>
      isAtBottom ? (reducedMotion ? "auto" : "smooth") : false,
    [reducedMotion],
  );

  const initialTopMostItemIndex = useMemo<number | { index: number; align: "start" }>(() => {
    if (messages.length === 0) return 0;
    if (unreadSeq !== null) {
      const unreadIndex = messages.findIndex((message) => message.seq === unreadSeq);
      if (unreadIndex >= 0) return { index: unreadIndex, align: "start" };
    }
    return messages.length - 1;
  }, [messages, unreadSeq]);

  const itemContent = useCallback(
    (_index: number, message: ChatMessage) => {
      const flag: ItemFlags = flagsById.get(message.id) ?? NO_ITEM_FLAGS;
      const withAttachments: ChatMessage =
        attachmentsByMessage?.[message.id] === undefined
          ? message
          : { ...message, attachments: attachmentsByMessage[message.id] };
      return (
        <div
          data-mz-article
          role="article"
          tabIndex={-1}
          className={`group/article px-4 ${message.seq === highlightSeq ? "rounded-[var(--radius-md)] ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-app)]" : ""}`}
        >
          {flag.dayChanged && <DayDivider iso={message.createdAt} />}
          {flag.firstUnread && <UnreadDivider />}
          <MessageBubble
            message={withAttachments}
            isOwn={message.senderId === currentUserId}
            grouped={flag.grouped}
            onRetry={onRetry}
            onEdit={onEdit}
            onDelete={onDelete}
            onOpenImage={onOpenImage}
            onDownloadFile={onDownloadFile}
            downloadProgressByAttachment={downloadProgressByAttachment}
          />
        </div>
      );
    },
    [
      flagsById,
      currentUserId,
      onRetry,
      onEdit,
      onDelete,
      onOpenImage,
      onDownloadFile,
      attachmentsByMessage,
      highlightSeq,
      downloadProgressByAttachment,
    ],
  );

  const ListHeader = useMemo(() => {
    const Header = (): ReactNode => {
      const dict = useI18n();
      if (!loadingOlder) return null;
      return (
        <div className="flex items-center justify-center gap-2 py-2 text-[var(--text-3)]">
          <Loader size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
          <span className="text-[length:var(--fs-meta)]">{dict.ui.loading}</span>
        </div>
      );
    };
    return Header;
  }, [loadingOlder]);

  const handleFeedKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const container = containerRef.current;
    if (container === null) return;
    const articles = Array.from(container.querySelectorAll<HTMLElement>("[data-mz-article]"));
    if (articles.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIndex = active === null ? -1 : articles.indexOf(active);
    if (event.key === "ArrowDown" && currentIndex === articles.length - 1) return;
    if (event.key === "ArrowUp" && currentIndex <= 0) return;
    const nextIndex =
      event.key === "ArrowDown" ? Math.min(articles.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
    event.preventDefault();
    const target = articles[nextIndex];
    if (target === undefined) return;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  };

  // Feed semântico na borda dos artigos (FeedList) — memoizado para o
  // Virtuoso não remontar a lista a cada render. O Scroller é a região
  // rolável com foco de teclado (rotulada) da lista.
  const virtuosoComponents = useMemo(() => {
    const label = feedLabel ?? t.appName;
    const FeedList = forwardRef<
      HTMLDivElement,
      ListProps<HTMLDivElement> & React.HTMLAttributes<HTMLDivElement>
    >(function FeedListImpl(props, ref) {
      return <div {...props} ref={ref} role="feed" aria-label={label} />;
    });
    FeedList.displayName = "FeedList";

    const FeedScroller = forwardRef<
      HTMLDivElement,
      ScrollerProps & React.HTMLAttributes<HTMLDivElement>
    >(function FeedScrollerImpl(props, ref) {
      return (
        <FeedScrollerBase
          {...props}
          ref={ref}
          role="region"
          aria-label={label}
          tabIndex={0}
          data-test-id="virtuoso-scroller"
        />
      );
    });
    FeedScroller.displayName = "FeedScroller";

    return { Header: ListHeader, Scroller: FeedScroller, List: FeedList };
  }, [ListHeader, feedLabel, t]);

  const jumpToLatest = () => {
    setUnseen(0);
    if (messages.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      align: "end",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  return (
    <div
      ref={containerRef}
      aria-busy={loadingOlder || undefined}
      onKeyDown={handleFeedKeyDown}
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-app)] ${className ?? ""}`}
    >
      {messages.length === 0 ? (
        <EmptyState icon={<Inbox size={24} strokeWidth={1.75} />} title={t.chat.empty} />
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={initialTopMostItemIndex}
          followOutput={followOutput}
          atBottomStateChange={handleAtBottomChange}
          rangeChanged={setVisibleRange}
          startReached={handleStartReached}
          itemContent={itemContent}
          components={virtuosoComponents}
          style={{ height: "100%", width: "100%" }}
        />
      )}
      {unseen > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="tz-colors absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[length:var(--fs-list)] font-medium text-[var(--accent)] shadow-[var(--shadow-2)] hover:bg-[var(--bg-hover)]"
        >
          <span className="nums-tabular">{interpolate(t.chat.newMessagesPill, { count: unseen })}</span>
          <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      <MessageAnnouncer text={announcement} />
    </div>
  );
}
