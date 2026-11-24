import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { useShortcutScope, type ShortcutHandlers } from "../../app/ShortcutsProvider";
import { useToast } from "../../app/ToastProvider";
import { EmptyState, Skeleton } from "../../components/ui";
import {
  Composer,
  ConversationHeader,
  Lightbox,
  MessageList,
  NudgeOverlay,
  TypingIndicator,
  type ChatAttachment,
  type LightboxImage,
} from "../../components/chat";
import type { ChatMessage as ComponentMessage } from "../../components/chat";
import type { Attachment, ChatMessage as StoreMessage } from "../../types";
import { endpoints, ApiError } from "../../lib/api";
import { downloadAttachment } from "../../lib/files";
import { openConversationWindow, setPreferences } from "../../lib/platform";
import { notifyTyping, sendNudge, stopTypingNotification } from "../../lib/realtime";
import { useApp } from "../../store";
import { attachmentObjectUrl, attachmentToChat, fileErrorMessage } from "../files/attachments";
import type { useUploads } from "../files/useUploads";
import { DetailsPanel, type DetailsMember } from "../conversations/DetailsPanel";

const PAGE_SIZE = 50;
const FIRST_ITEM_INDEX_BASE = 100_000;

export interface MessageJump {
  conversationId: string;
  seq: number;
}

export interface ConversationPaneProps {
  uploads: ReturnType<typeof useUploads>;
  archivedChannels: Set<string>;
  jump: MessageJump | null;
  onJumpHandled: () => void;
  /** Sinal do drag-and-drop na janela inteira (visual no composer, §8.6). */
  isDragActive: boolean;
}

interface PagingState {
  loading: boolean;
  hasMore: Record<string, boolean>;
  firstItemIndex: Record<string, number>;
  unreadSeq: Record<string, number | null>;
}

/**
 * Conversa (§4/§8/§9): cabeçalho com ações, lista virtualizada com regras de
 * scroll/leitura (§8.2), composer com rascunho persistente, edição da última
 * mensagem (↑), nudge com cota, anexos com progresso, lightbox e detalhes.
 */
export function ConversationPane({
  uploads,
  archivedChannels,
  jump,
  onJumpHandled,
  isDragActive,
}: ConversationPaneProps) {
  const t = useI18n();
  const toast = useToast();
  const user = useApp((state) => state.user);
  const users = useApp((state) => state.users);
  const conversations = useApp((state) => state.conversations);
  const presence = useApp((state) => state.presence);
  const typing = useApp((state) => state.typing);
  const activeId = useApp((state) => state.activeConversationId);
  const windowFocused = useApp((state) => state.windowFocused);
  const connection = useApp((state) => state.connection);
  const muted = useApp((state) => state.mutedConversations);
  const drafts = useApp((state) => state.drafts);
  const storeMessages = useApp((state) =>
    state.activeConversationId !== null ? state.messagesByConversation[state.activeConversationId] : undefined,
  );
  const appendMessages = useApp((state) => state.appendMessages);
  const setDraft = useApp((state) => state.setDraft);
  const sendMessage = useApp((state) => state.sendMessage);
  const retryMessage = useApp((state) => state.retryMessage);
  const markRead = useApp((state) => state.markRead);
  const setMuted = useApp((state) => state.setMutedConversations);
  const myStatus = useApp((state) => state.myStatus);
  const statusNotes = useApp((state) => state.statusNotes);
  const lastNudge = useApp((state) => state.lastNudge);
  const setLastNudge = useApp((state) => state.setLastNudge);

  const [paging, setPaging] = useState<PagingState>(() => ({
    loading: true,
    hasMore: {},
    firstItemIndex: {},
    unreadSeq: {},
  }));
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Record<string, ChatAttachment[]>>({});
  const [serverRecords, setServerRecords] = useState<Record<string, Attachment>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<{ messageId: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(
    () => conversations.find((entry) => entry.conversation.id === activeId) ?? null,
    [conversations, activeId],
  );
  const conversation = summary?.conversation ?? null;
  const archived =
    conversation !== null && conversation.kind === "channel" && archivedChannels.has(conversation.id);
  const peerInactive =
    conversation !== null && conversation.kind === "dm" && conversation.peer_is_active === false;
  const disabledReason = archived
    ? t.details.archivedNote
    : peerInactive
      ? t.chat.composer.peerInactive
      : undefined;

  // Carga inicial por conversa (abre posicionando na primeira não lida, §8.2)
  const openUnreadRef = useRef(summary?.unread_count ?? 0);
  openUnreadRef.current = summary?.unread_count ?? 0;

  const needsLoad = storeMessages === undefined;

  useEffect(() => {
    if (activeId === null || conversation === null) return;
    if (!needsLoad) {
      setPaging((current) => ({ ...current, loading: false }));
      return;
    }
    let cancelled = false;
    const unreadAtOpen = openUnreadRef.current;
    // Página MAIS RECENTE (§8.2): o servidor sem cursor devolve a página
    // MAIS ANTIGA — abrir conversas longas mostrava o início do histórico
    // em vez da janela atual; beforeSeq = última seq conhecida + 1 pede a
    // página mais recente em ordem cronológica.
    const newestSeq = summary?.last_message?.seq ?? 0;
    setPaging((current) => ({ ...current, loading: true }));
    void endpoints
      .listMessages(activeId, { beforeSeq: newestSeq + 1, limit: PAGE_SIZE })
      .then((list) => {
        if (cancelled) return;
        appendMessages(activeId, list);
        const lastSeq = list.length > 0 ? list[list.length - 1].seq : 0;
        const unreadSeq =
          unreadAtOpen > 0 && unreadAtOpen <= list.length ? lastSeq - unreadAtOpen + 1 : null;
        setPaging((current) => ({
          loading: false,
          hasMore: { ...current.hasMore, [activeId]: list.length === PAGE_SIZE },
          firstItemIndex: { ...current.firstItemIndex, [activeId]: FIRST_ITEM_INDEX_BASE },
          unreadSeq: { ...current.unreadSeq, [activeId]: unreadSeq },
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setPaging((current) => ({ ...current, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, conversation === null, needsLoad, appendMessages]);

  // §8.2: marca como lida 1 s após abrir com a janela focada; desfocar congela.
  useEffect(() => {
    if (activeId === null || conversation === null || !windowFocused) return;
    const timer = window.setTimeout(() => markRead(activeId), 1_000);
    return () => window.clearTimeout(timer);
  }, [activeId, windowFocused, conversation === null, markRead]);

  const nameOf = useCallback(
    (userId: string): string =>
      users.find((entry) => entry.id === userId)?.display_name ?? t.nav.unknownUser,
    [users, t],
  );

  const messages = useMemo<ComponentMessage[]>(() => {
    if (storeMessages === undefined) return [];
    return storeMessages.map((message: StoreMessage) => ({
      id: message.id,
      seq: message.local === undefined ? message.seq : undefined,
      senderId: message.sender_id,
      senderName: nameOf(message.sender_id),
      createdAt: message.created_at,
      body: message.body,
      delivery: message.local?.status ?? "sent",
      editedAt: message.edited_at,
      deletedAt: message.deleted_at,
    }));
  }, [storeMessages, nameOf]);

  // Salto da busca (§8.7): rola até a mensagem e destaca 2 s.
  useEffect(() => {
    if (jump === null || activeId === null || jump.conversationId !== activeId) return;
    setHighlightSeq(jump.seq);
    onJumpHandled();
    const timer = window.setTimeout(() => setHighlightSeq(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [jump, activeId, onJumpHandled]);

  // Anexos sob demanda (mensagens visíveis apenas — §11 sem N+1 em 20k msgs).
  const requestAttachments = useCallback((messageId: string) => {
    void (async () => {
      try {
        const list = await endpoints.listMessageAttachments(messageId);
        const mapped = await Promise.all(
          list.map(async (attachment: Attachment) => {
            if (attachment.mime_type.toLowerCase().startsWith("image/")) {
              const thumbnail = await attachmentObjectUrl(attachment, "thumbnail").catch(() => null);
              return attachmentToChat(attachment, { thumbnail });
            }
            return attachmentToChat(attachment);
          }),
        );
        setServerRecords((current) => {
          const next = { ...current };
          for (const attachment of list) next[attachment.id] = attachment;
          return next;
        });
        setAttachmentsByMessage((current) => ({ ...current, [messageId]: mapped }));
      } catch {
        setAttachmentsByMessage((current) => ({ ...current, [messageId]: [] }));
      }
    })();
  }, []);

  // Paginação para trás (§8.2): âncora por seq — firstItemIndex compensa o
  // prepend no Virtuoso, sem "pulo" de scroll.
  const loadOlder = useCallback(() => {
    if (activeId === null || storeMessages === undefined || storeMessages.length === 0) return;
    const firstConfirmed = storeMessages.find((message) => message.local === undefined);
    if (firstConfirmed === undefined) return;
    void endpoints
      .listMessages(activeId, { beforeSeq: firstConfirmed.seq, limit: PAGE_SIZE })
      .then((list) => {
        if (list.length === 0) {
          setPaging((current) => ({ ...current, hasMore: { ...current.hasMore, [activeId]: false } }));
          return;
        }
        const existing = new Set(storeMessages.map((message) => message.id));
        const fresh = list.filter((message) => !existing.has(message.id));
        appendMessages(activeId, list);
        setPaging((current) => ({
          ...current,
          hasMore: { ...current.hasMore, [activeId]: list.length === PAGE_SIZE },
          firstItemIndex: {
            ...current.firstItemIndex,
            [activeId]: (current.firstItemIndex[activeId] ?? FIRST_ITEM_INDEX_BASE) - fresh.length,
          },
        }));
      })
      .catch(() => undefined);
  }, [activeId, storeMessages, appendMessages]);

  // ----- Composer ------------------------------------------------------------

  const draft = activeId !== null ? (drafts[activeId] ?? "") : "";

  const handleChange = (value: string) => {
    if (activeId === null) return;
    setDraft(activeId, value);
    notifyTyping(activeId);
  };

  const send = (text: string) => {
    if (activeId === null) return;
    if (editing !== null) {
      const targetId = editing.messageId;
      setEditing(null);
      setDraft(activeId, "");
      void endpoints
        .editMessage(targetId, text)
        .then((updated) => useApp.getState().updateMessage(updated))
        .catch((error: unknown) => {
          toast.show({ kind: "error", message: fileErrorMessage(t, apiErrorKey(error)) });
        });
      return;
    }
    const ready = uploads.readyAttachments(activeId);
    sendMessage({
      conversationId: activeId,
      body: text,
      attachmentIds: ready.map((attachment) => attachment.id),
    });
    uploads.clearReady(activeId);
    stopTypingNotification(activeId);
  };

  const addFiles = (files: File[]): void => {
    if (activeId === null) return;
    const errorKeys = uploads.addFiles(activeId, files);
    if (errorKeys.length > 0) {
      toast.show({ kind: "error", message: fileErrorMessage(t, errorKeys[0]) });
    }
  };

  const handleNudge = (): void => {
    if (activeId === null) return;
    const ok = sendNudge(activeId);
    toast.show({ kind: ok ? "info" : "error", message: ok ? t.nudge.sent : t.nudge.cooldown });
  };

  const toggleMute = (): void => {
    if (activeId === null) return;
    const next = muted.includes(activeId) ? muted.filter((id) => id !== activeId) : [...muted, activeId];
    setMuted(next);
    void setPreferences({ mutedConversations: next });
  };

  // ----- Ações de mensagem ---------------------------------------------------

  const apiErrorKey = (error: unknown): string | null =>
    error instanceof ApiError ? `errors.api.${error.code}` : null;

  const retry = (message: ComponentMessage): void => {
    const storeMessage = (storeMessages ?? []).find((entry) => entry.id === message.id);
    if (storeMessage === undefined) return;
    retryMessage(storeMessage.client_id);
  };

  const startEdit = (message: ComponentMessage): void => {
    if (activeId === null) return;
    setEditing({ messageId: message.id });
    setDraft(activeId, message.body);
  };

  const cancelEdit = (): void => {
    if (activeId === null) return;
    setEditing(null);
    setDraft(activeId, "");
  };

  const deleteMessage = (message: ComponentMessage): void => {
    void endpoints
      .deleteMessage(message.id)
      .then(() => {
        if (activeId !== null) useApp.getState().removeMessage(activeId, message.id);
      })
      .catch((error: unknown) => {
        toast.show({ kind: "error", message: fileErrorMessage(t, apiErrorKey(error)) });
      });
  };

  const download = useCallback(
    (attachment: ChatAttachment): void => {
      const record = serverRecords[attachment.id];
      if (record === undefined) return;
      void (async () => {
        try {
          await downloadAttachment(record, {
            onProgress: ({ loaded, total }) => {
              const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
              setDownloadProgress((current) => ({ ...current, [attachment.id]: percent }));
            },
          });
          setDownloadProgress((current) => {
            const next = { ...current };
            delete next[attachment.id];
            return next;
          });
          toast.show({ kind: "success", message: t.toast.downloadSaved });
        } catch (error) {
          setDownloadProgress((current) => {
            const next = { ...current };
            delete next[attachment.id];
            return next;
          });
          if (error instanceof Error && "key" in error && typeof error.key === "string") {
            toast.show({ kind: "error", message: fileErrorMessage(t, error.key) });
            return;
          }
          toast.show({ kind: "error", message: fileErrorMessage(t, apiErrorKey(error)) });
        }
      })();
    },
    [serverRecords, toast, t],
  );

  const openImage = useCallback(
    (attachment: ChatAttachment): void => {
      const record = serverRecords[attachment.id];
      if (record === undefined) return;
      void (async () => {
        try {
          const url = await attachmentObjectUrl(record, "full");
          setLightbox({
            images: [
              {
                src: url,
                alt: attachment.filename,
                filename: attachment.filename,
                sizeBytes: attachment.sizeBytes,
              },
            ],
            index: 0,
          });
        } catch (error) {
          toast.show({ kind: "error", message: fileErrorMessage(t, apiErrorKey(error)) });
        }
      })();
    },
    [serverRecords, toast, t],
  );

  // ----- Atalhos (§10) -------------------------------------------------------

  const lastOwnSent = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.senderId === user?.id && message.delivery === "sent" && message.deletedAt === null) {
        return message;
      }
    }
    return null;
  }, [messages, user?.id]);

  const shortcuts: ShortcutHandlers = {
    attach: () => {
      fileInputRef.current?.click();
      return true;
    },
    close: () => {
      if (lightbox !== null) return true; // Radix Dialog fecha o lightbox
      if (detailsOpen) {
        setDetailsOpen(false);
        return true;
      }
      return false;
    },
    editLastMessage: (event) => {
      const target = event.target as HTMLElement | null;
      if (target === null || target.tagName !== "TEXTAREA") return false;
      if (draft.trim().length > 0 || editing !== null || lastOwnSent === null) return false;
      if (disabledReason !== undefined) return false;
      startEdit(lastOwnSent);
      return true;
    },
  };
  useShortcutScope(shortcuts, { id: "conversation-pane" });

  // ----- Detalhes ------------------------------------------------------------

  const members = useMemo<DetailsMember[]>(() => {
    if (conversation === null) return [];
    const me: DetailsMember = {
      id: user?.id ?? "me",
      name: user?.display_name ?? t.nav.unknownUser,
      presence: myStatus,
    };
    if (conversation.kind === "dm") {
      const peer = users.find((entry) => entry.id === conversation.peer_id);
      if (peer === undefined) return [me];
      return [
        me,
        {
          id: peer.id,
          name: peer.display_name,
          presence: peer.is_active ? (presence[peer.id] ?? peer.presence ?? "offline") : undefined,
          inactive: !peer.is_active,
        },
      ];
    }
    const sectorUsers = users
      .filter((entry) => entry.sector_id === conversation.sector_id && entry.id !== user?.id)
      .map<DetailsMember>((entry) => ({
        id: entry.id,
        name: entry.display_name,
        presence: entry.is_active ? (presence[entry.id] ?? "offline") : undefined,
        inactive: !entry.is_active,
      }));
    return [me, ...sectorUsers];
  }, [conversation, users, presence, user, myStatus, t]);

  const onlineCount = members.filter(
    (member) =>
      !member.inactive &&
      member.presence !== undefined &&
      member.presence !== "offline" &&
      member.presence !== "invisible",
  ).length;

  const sharedAttachments = useMemo<ChatAttachment[]>(() => {
    if (storeMessages === undefined) return [];
    const list: ChatAttachment[] = [];
    for (const message of storeMessages) {
      for (const attachment of attachmentsByMessage[message.id] ?? []) {
        list.push(attachment);
      }
    }
    return list.reverse();
  }, [storeMessages, attachmentsByMessage]);

  // ----- Render --------------------------------------------------------------

  if (conversation === null) {
    return (
      <div className="flex min-w-0 flex-1 bg-[var(--bg-app)]">
        <EmptyState icon={<MessageSquare size={24} strokeWidth={1.75} />} title={t.conversation.empty} />
      </div>
    );
  }

  const peer = conversation.kind === "dm" ? users.find((entry) => entry.id === conversation.peer_id) : undefined;
  const title =
    conversation.kind === "channel"
      ? (conversation.name ?? t.nav.sectorFallback)
      : (peer?.display_name ?? t.nav.unknownUser);
  const typingPeople = (typing[conversation.id] ?? [])
    .filter((id) => id !== user?.id)
    .map((id) => ({ id, name: nameOf(id) }));
  const pendingItems = uploads.entriesFor(conversation.id).map((entry) => ({
    id: entry.localId,
    filename: entry.filename,
    sizeBytes: entry.sizeBytes,
    state: entry.state,
    progress: entry.progress,
  }));
  const nudgeHere =
    lastNudge !== null &&
    lastNudge.conversationId === conversation.id &&
    Date.now() - lastNudge.at <= 8_000;

  return (
    <div className="flex min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col bg-[var(--bg-app)]">
        <NudgeOverlay
          active={nudgeHere}
          senderName={lastNudge === null ? "" : nameOf(lastNudge.fromUserId)}
          onDismiss={() => setLastNudge(null)}
        />
        <ConversationHeader
          kind={conversation.kind}
          title={title}
          memberCount={conversation.kind === "channel" ? members.length : undefined}
          onlineCount={conversation.kind === "channel" ? onlineCount : undefined}
          peerPresence={
            conversation.kind === "dm" && peer !== undefined && peer.is_active
              ? (presence[peer.id] ?? peer.presence ?? "offline")
              : undefined
          }
          peerNote={
            conversation.kind === "dm" && peer !== undefined
              ? (statusNotes[peer.id] === "" ? undefined : statusNotes[peer.id])
              : undefined
          }
          muted={muted.includes(conversation.id)}
          archived={archived}
          onToggleMute={toggleMute}
          onShowDetails={() => setDetailsOpen((open) => !open)}
          onOpenInWindow={() => void openConversationWindow(conversation.id)}
        />

        {paging.loading && storeMessages === undefined ? (
          <div className="min-h-0 flex-1 p-4">
            <Skeleton variant="message" rows={6} />
          </div>
        ) : (
          <MessageList
            key={conversation.id}
            messages={messages}
            currentUserId={user?.id ?? ""}
            feedLabel={title}
            firstItemIndex={paging.firstItemIndex[conversation.id] ?? FIRST_ITEM_INDEX_BASE}
            hasMore={paging.hasMore[conversation.id] ?? false}
            onLoadOlder={loadOlder}
            unreadSeq={paging.unreadSeq[conversation.id] ?? null}
            highlightSeq={highlightSeq}
            attachmentsByMessage={attachmentsByMessage}
            requestAttachments={requestAttachments}
            downloadProgressByAttachment={downloadProgress}
            onRetry={retry}
            onEdit={startEdit}
            onDelete={deleteMessage}
            onOpenImage={(attachment) => openImage(attachment)}
            onDownloadFile={(attachment) => download(attachment)}
          />
        )}

        <TypingIndicator people={typingPeople} />

        <Composer
          value={draft}
          onChange={handleChange}
          onSend={send}
          onAttach={() => fileInputRef.current?.click()}
          onNudge={handleNudge}
          canNudge={connection === "online"}
          pendingAttachments={pendingItems}
          onRemoveAttachment={(localId) => uploads.remove(conversation.id, localId)}
          onCancelUpload={(localId) => uploads.cancel(conversation.id, localId)}
          onRetryUpload={(localId) => uploads.retry(conversation.id, localId)}
          onFilesPasted={addFiles}
          isDragActive={isDragActive}
          editing={editing !== null}
          onCancelEdit={cancelEdit}
          disabledReason={disabledReason}
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            if (fileInputRef.current !== null) fileInputRef.current.value = "";
          }}
        />
      </main>

      {detailsOpen && (
        <DetailsPanel
          title={title}
          members={members}
          attachments={sharedAttachments}
          archived={archived}
          onDownload={download}
          onOpenImage={openImage}
          onClose={() => setDetailsOpen(false)}
        />
      )}

      {lightbox !== null && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) =>
            setLightbox((current) => (current === null ? current : { ...current, index }))
          }
          onClose={() => setLightbox(null)}
          onDownload={(image) => {
            const attachment = sharedAttachments.find((item) => item.filename === image.filename);
            if (attachment !== undefined) download(attachment);
          }}
        />
      )}
    </div>
  );
}
