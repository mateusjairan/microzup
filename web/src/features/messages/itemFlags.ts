import { MESSAGE_GROUP_WINDOW_MS } from "../../components/utils/format";
import type { ChatMessage } from "../../components/chat/types";

/** Estado de renderização de um item da lista de mensagens. */
export interface ItemFlags {
  /** Primeira mensagem do dia — cabeçalho "Hoje/Ontem/data". */
  dayChanged: boolean;
  /** Mesma pessoa e dentro da janela de agrupamento: sem cabeçalho. */
  grouped: boolean;
  /** Primeira não lida: divisor "novas mensagens". */
  firstUnread: boolean;
}

/** Item sem flags conhecidas: nunca inventa divisor de dia. */
export const NO_ITEM_FLAGS: ItemFlags = { dayChanged: false, grouped: false, firstUnread: false };

export function isSameDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Flags por posição na ordem canônica (seq) da conversa. */
export function computeItemFlags(
  messages: readonly ChatMessage[],
  unreadSeq: number | null,
): ItemFlags[] {
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] : undefined;
    const dayChanged = !previous || !isSameDay(previous.createdAt, message.createdAt);
    const grouped =
      previous !== undefined &&
      !dayChanged &&
      previous.senderId === message.senderId &&
      !previous.deletedAt &&
      !message.deletedAt &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <=
        MESSAGE_GROUP_WINDOW_MS;
    const firstUnread = unreadSeq !== null && message.seq === unreadSeq;
    return { dayChanged, grouped, firstUnread };
  });
}

/**
 * Flags indexadas por `message.id`.
 *
 * A lista é virtualizada com `firstItemIndex` (base 100.000) para prepend
 * estável: o Virtuoso entrega ao `itemContent` o índice ABSOLUTO, não a posição
 * em `messages`. Indexar as flags por esse índice erra sempre (o array só tem
 * `messages.length` posições) e o item cai no fallback — era o que fazia o
 * divisor de dia ("Hoje") aparecer em toda mensagem. Por isso o mapa é por id:
 * independe do offset do Virtuoso.
 */
export function buildFlagIndex(
  messages: readonly ChatMessage[],
  unreadSeq: number | null,
): Map<string, ItemFlags> {
  const flags = computeItemFlags(messages, unreadSeq);
  const byId = new Map<string, ItemFlags>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const flag = flags[index];
    if (message === undefined || flag === undefined) continue;
    byId.set(message.id, flag);
  }
  return byId;
}
