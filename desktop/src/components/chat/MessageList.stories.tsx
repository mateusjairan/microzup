import { useCallback, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { MessageList } from "./MessageList";
import { isoDaysAgo, isoMinutesAgo, makeMessage, svgImage } from "../utils/storyFixtures";
import type { ChatMessage } from "./types";

const meta: Meta<typeof MessageList> = {
  title: "Chat/MessageList",
  component: MessageList,
};
export default meta;
type Story = StoryObj<typeof meta>;

const CURRENT_USER = "u-me";

function buildConversation(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    const isOwn = index % 3 === 1;
    const author = isOwn
      ? { senderId: CURRENT_USER, senderName: "Você" }
      : index % 3 === 0
        ? { senderId: "u-ana", senderName: "Ana Souza" }
        : { senderId: "u-bruno", senderName: "Bruno Lima" };
    const minutesAgo = count - index;
    messages.push(
      makeMessage({
        ...author,
        createdAt: isoMinutesAgo(minutesAgo),
        body:
          index % 7 === 3
            ? ""
            : `Mensagem ${index + 1} — desvio 045, lote 22, conferência do QA.`,
        attachments:
          index === 40
            ? [
                {
                  id: `a-${index}`,
                  kind: "image",
                  filename: "lote-22.png",
                  mimeType: "image/png",
                  sizeBytes: 2_202_009,
                  url: svgImage("#2563eb", `msg-${index}`),
                  state: "ready" as const,
                },
              ]
            : undefined,
      }),
    );
  }
  return messages;
}

function MessageListDemo({ initialCount, unreadSeq = null }: { initialCount: number; unreadSeq?: number | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => buildConversation(initialCount));
  const [firstItemIndex, setFirstItemIndex] = useState(100_000);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadOlder = useCallback(() => {
    setLoadingOlder(true);
    window.setTimeout(() => {
      const older: ChatMessage[] = Array.from({ length: 30 }, (_, index) =>
        makeMessage({
          senderId: index % 2 === 0 ? "u-ana" : "u-bruno",
          senderName: index % 2 === 0 ? "Ana Souza" : "Bruno Lima",
          createdAt: isoDaysAgo(3, 9, index + 10),
          body: `Mensagem antiga ${index + 1}.`,
        }),
      );
      setMessages((current) => [...older, ...current]);
      setFirstItemIndex((current) => current - older.length);
      setLoadingOlder(false);
    }, 700);
  }, []);

  return (
    <div className="flex h-[560px] w-[720px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <MessageList
        messages={messages}
        currentUserId={CURRENT_USER}
        firstItemIndex={firstItemIndex}
        hasMore
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        unreadSeq={unreadSeq}
        feedLabel="Qualidade e Assuntos Regulatórios"
        onOpenImage={() => undefined}
      />
    </div>
  );
}

export const ConversaLonga: Story = {
  render: () => <MessageListDemo initialCount={500} />,
};

export const AbreNaPrimeiraNaoLida: Story = {
  render: () => <MessageListDemo initialCount={120} unreadSeq={95} />,
};

export const Vazia: Story = {
  render: () => (
    <div className="flex h-[400px] w-[720px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <MessageList messages={[]} currentUserId={CURRENT_USER} feedLabel="Nova conversa" />
    </div>
  ),
};

export const Carregando: Story = {
  render: () => (
    <div className="flex h-[400px] w-[720px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <Skeleton variant="message" rows={5} />
    </div>
  ),
};

function AppendDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => buildConversation(30));
  const append = () => {
    setMessages((current) => [
      ...current,
      makeMessage({
        senderId: "u-ana",
        senderName: "Ana Souza",
        createdAt: new Date().toISOString(),
        body: "Nova mensagem que chegou agora.",
      }),
    ]);
  };
  return (
    <div className="flex h-[560px] w-[720px] flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={append}>
          Chegar mensagem nova
        </Button>
        <span className="self-center text-[length:var(--fs-meta)] text-[var(--text-3)]">
          Role para cima e envie — a pill “N novas mensagens” aparece.
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
        <MessageList messages={messages} currentUserId={CURRENT_USER} feedLabel="Demo" />
      </div>
    </div>
  );
}

export const PillDeNovasMensagens: Story = {
  render: () => <AppendDemo />,
};
