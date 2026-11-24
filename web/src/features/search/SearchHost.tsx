import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../app/I18nProvider";
import { CommandPalette, type CommandItem } from "../../components/chat";
import { formatClock, formatFileSize } from "../../components/utils/format";
import { api, endpoints, ApiError } from "../../lib/api";
import { useApp } from "../../store";
import type { Message, User } from "../../types";
import type { components } from "../../types/api";

type SearchOut = components["schemas"]["SearchOut"];
type FileHitOut = components["schemas"]["FileHitOut"];

export type SearchMode = "global" | "people" | "conversation";

export interface SearchHostProps {
  open: boolean;
  mode: SearchMode;
  onClose: () => void;
  /** Resultado de mensagem: abre a conversa na posição com destaque (§8.7). */
  onJumpToMessage: (conversationId: string, seq: number) => void;
}

const MESSAGE_SEARCH_MIN = 3;
const DEBOUNCE_MS = 300;

/**
 * Envelope defensivo: o contrato é `SearchOut { messages, files }`, mas a UI
 * nunca confia cega no payload — formato inesperado vira estado de erro,
 * nunca exceção não-tratada (página branca).
 */
function isSearchOut(value: unknown): value is SearchOut {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.messages) && Array.isArray(record.files);
}

/**
 * Palette (§8.7/§10): conversas e pessoas filtram instantâneo local; mensagens
 * com debounce de 300 ms → GET /search (envelope `SearchOut`). No modo
 * conversa (Ctrl+F) o pedido leva `conversation_id` da conversa ativa.
 *
 * Hits de ARQUIVO entram no mesmo grupo com o nome do arquivo + tamanho +
 * horário; Enter abre a conversa na posição da MENSAGEM VINCULADA com
 * destaque de 2 s (interação mais simples consistente com §8.7 — não há
 * aba de detalhes por arquivo na palette).
 */
export function SearchHost({ open, mode, onClose, onJumpToMessage }: SearchHostProps) {
  const t = useI18n();
  const users = useApp((state) => state.users);
  const me = useApp((state) => state.user);
  const conversations = useApp((state) => state.conversations);
  const activeId = useApp((state) => state.activeConversationId);
  const setActive = useApp((state) => state.setActiveConversation);
  const setConversations = useApp((state) => state.setConversations);

  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Message[]>([]);
  const [fileHits, setFileHits] = useState<FileHitOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageIndex = useRef(new Map<string, { conversationId: string; seq: number }>());

  useEffect(() => {
    if (open) {
      setQuery("");
      setRemote([]);
      setFileHits([]);
      setError(null);
    }
  }, [open, mode]);

  // Debounce: global (sem filtro) e conversa (com conversation_id — Ctrl+F
  // busca no servidor, não no carregado).
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < MESSAGE_SEARCH_MIN) {
      setRemote([]);
      setFileHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (mode === "conversation" && activeId === null) {
      setRemote([]);
      setFileHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: term });
      if (mode === "conversation" && activeId !== null) {
        params.set("conversation_id", activeId);
      }
      void api
        .get<SearchOut>(`/search?${params.toString()}`)
        .then((raw: unknown) => {
          if (!isSearchOut(raw)) {
            setRemote([]);
            setFileHits([]);
            setError(t.chat.search.error);
            setLoading(false);
            return;
          }
          setRemote(raw.messages);
          setFileHits(raw.files);
          setError(null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          setRemote([]);
          setFileHits([]);
          setError(err instanceof ApiError ? err.message : t.chat.search.error);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, mode, query, activeId, t]);

  const nameOf = (userId: string): string =>
    users.find((entry) => entry.id === userId)?.display_name ?? t.nav.unknownUser;

  const conversationItems = useMemo(() => {
    if (mode === "conversation") return [];
    const term = query.trim().toLowerCase();
    return conversations
      .filter((summary) => {
        if (term.length === 0) return true;
        const name =
          summary.conversation.kind === "dm"
            ? nameOf(summary.conversation.peer_id ?? "")
            : (summary.conversation.name ?? "");
        return name.toLowerCase().includes(term);
      })
      .slice(0, 8)
      .map<CommandItem>((summary) => {
        const peer = users.find((entry) => entry.id === summary.conversation.peer_id);
        const name =
          summary.conversation.kind === "dm"
            ? (peer?.display_name ?? t.nav.unknownUser)
            : (summary.conversation.name ?? t.nav.sectorFallback);
        return {
          id: summary.conversation.id,
          kind: "conversation",
          title: name,
          subtitle: summary.unread_count > 0 ? t.conversation.newMessages : undefined,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, users, query, mode, t]);

  const peopleItems = useMemo(() => {
    if (mode === "conversation") return [];
    const term = query.trim().toLowerCase();
    return users
      .filter((entry) => entry.id !== me?.id && entry.is_active)
      .filter((entry) => {
        if (term.length === 0) return true;
        return (
          entry.display_name.toLowerCase().includes(term) ||
          entry.username.toLowerCase().includes(term)
        );
      })
      .slice(0, 8)
      .map<CommandItem>((entry: User) => ({
        id: entry.id,
        kind: "person",
        title: entry.display_name,
        subtitle: `@${entry.username}`,
        presence: entry.presence,
      }));
  }, [users, me?.id, query, mode]);

  const messageItems = useMemo(() => {
    messageIndex.current.clear();
    const fromMessages = remote.map<CommandItem>((message) => {
      messageIndex.current.set(message.id, {
        conversationId: message.conversation_id,
        seq: message.seq,
      });
      return {
        id: message.id,
        kind: "message",
        title: nameOf(message.sender_id),
        subtitle: `${formatClock(message.created_at)} · ${message.body}`,
      };
    });
    const fromFiles = fileHits.map<CommandItem>((hit) => {
      messageIndex.current.set(hit.id, {
        conversationId: hit.conversation_id,
        seq: hit.message_seq,
      });
      return {
        id: hit.id,
        kind: "message",
        title: hit.filename,
        subtitle: `${formatFileSize(hit.size_bytes, t.format.units)} · ${formatClock(hit.message_created_at)}`,
      };
    });
    return [...fromMessages, ...fromFiles];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, fileHits, users, t]);

  async function openResult(item: CommandItem) {
    onClose();
    if (item.kind === "conversation") {
      setActive(item.id);
      return;
    }
    if (item.kind === "person") {
      try {
        const conversation = await endpoints.openDm(item.id);
        const next = await endpoints.listConversations();
        setConversations(next);
        setActive(conversation.id);
      } catch {
        // falha silenciosa: a palette fecha e a sidebar mostra o erro no próximo uso
      }
      return;
    }
    const located = messageIndex.current.get(item.id);
    if (located === undefined) return;
    setActive(located.conversationId);
    onJumpToMessage(located.conversationId, located.seq);
  }

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      conversations={conversationItems}
      people={peopleItems}
      messages={messageItems}
      loading={loading}
      errorMessage={error}
      preferredGroup={mode === "people" ? "people" : undefined}
      messagesGroupLabel={mode === "conversation" ? t.chat.search.messagesInConversation : undefined}
      onOpenResult={(item) => void openResult(item)}
    />
  );
}
