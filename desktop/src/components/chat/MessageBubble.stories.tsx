import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageBubble } from "./MessageBubble";
import { isoMinutesAgo } from "../utils/storyFixtures";
import { svgImage } from "../utils/storyFixtures";
import type { ChatMessage } from "./types";

const meta: Meta<typeof MessageBubble> = {
  title: "Chat/MessageBubble",
  component: MessageBubble,
};
export default meta;
type Story = StoryObj<typeof meta>;

const CURRENT_USER = "u-me";

const received: ChatMessage = {
  id: "m-1",
  seq: 1,
  senderId: "u-ana",
  senderName: "Ana Souza",
  createdAt: isoMinutesAgo(12),
  body: "Recebido. Vou conferir com o QA e te devolvo o parecer hoje.",
  delivery: "sent",
};

const own: ChatMessage = {
  ...received,
  id: "m-2",
  seq: 2,
  senderId: CURRENT_USER,
  senderName: "Você",
  body: "Perfeito, obrigado!",
};

export const RecebidaEPropria: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
      <MessageBubble message={received} isOwn={false} />
      <MessageBubble message={own} isOwn />
    </div>
  ),
};

export const Agrupadas: Story = {
  render: () => {
    const first: ChatMessage = {
      ...received,
      id: "m-3",
      createdAt: isoMinutesAgo(5),
      body: "Três pontos do desvio 045 revisados.",
    };
    const second: ChatMessage = {
      ...first,
      id: "m-4",
      createdAt: isoMinutesAgo(4),
      body: "O quarto ponto segue em aberto.",
    };
    return (
      <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
        <MessageBubble message={first} isOwn={false} />
        <MessageBubble message={second} isOwn={false} grouped />
      </div>
    );
  },
};

export const Enviando: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
      <MessageBubble
        message={{ ...own, delivery: "sending", body: "Enviando otimista — ainda sem seq." }}
        isOwn
      />
    </div>
  ),
};

export const FalhouComReenviar: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
      <MessageBubble
        message={{ ...own, delivery: "failed", body: "Mensagem que não chegou ao servidor." }}
        isOwn
        onRetry={() => undefined}
      />
    </div>
  ),
};

export const EditadaComTooltip: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
      <MessageBubble
        message={{ ...own, editedAt: isoMinutesAgo(3), body: "Perfeito, obrigado! (texto revisado)" }}
        isOwn
      />
    </div>
  ),
};

export const Apagada: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
      <MessageBubble message={{ ...own, deletedAt: isoMinutesAgo(2), body: "" }} isOwn />
    </div>
  ),
};

export const ComAnexoImagem: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col bg-[var(--bg-app)] p-4">
      <MessageBubble
        message={{
          ...received,
          id: "m-5",
          body: "",
          attachments: [
            {
              id: "a-1",
              kind: "image",
              filename: "lote-22.png",
              mimeType: "image/png",
              sizeBytes: 2_202_009,
              url: svgImage("#0f766e", "lote-22"),
              state: "ready",
            },
          ],
        }}
        isOwn={false}
        onOpenImage={() => undefined}
      />
    </div>
  ),
};

export const ComAnexoPdfEUpload: Story = {
  render: () => (
    <div className="flex w-[560px] flex-col gap-3 bg-[var(--bg-app)] p-4">
      <MessageBubble
        message={{
          ...received,
          id: "m-6",
          body: "",
          attachments: [
            {
              id: "a-2",
              kind: "file",
              filename: "desvio-045.pdf",
              mimeType: "application/pdf",
              sizeBytes: 2_202_009,
              state: "ready",
            },
          ],
        }}
        isOwn={false}
        onDownloadFile={() => undefined}
      />
      <MessageBubble
        message={{
          ...own,
          id: "m-7",
          body: "",
          attachments: [
            {
              id: "a-3",
              kind: "file",
              filename: "parecer-qa.xlsx",
              mimeType: "application/vnd.ms-excel",
              sizeBytes: 84_320,
              state: "uploading",
              progress: 64,
            },
          ],
        }}
        isOwn
      />
    </div>
  ),
};
