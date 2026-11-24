import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImageMessage } from "./ImageMessage";
import { svgImage } from "../utils/storyFixtures";
import type { ChatAttachment } from "./types";

const meta: Meta<typeof ImageMessage> = {
  title: "Chat/ImageMessage",
  component: ImageMessage,
};
export default meta;
type Story = StoryObj<typeof meta>;

const ready: ChatAttachment = {
  id: "i-1",
  kind: "image",
  filename: "lote-22.png",
  mimeType: "image/png",
  sizeBytes: 2_202_009,
  url: svgImage("#0f766e", "lote-22"),
  state: "ready",
};

export const MiniaturaComLegenda: Story = {
  render: () => (
    <div className="flex flex-col gap-3 bg-[var(--bg-app)] p-4">
      <ImageMessage attachment={ready} caption="lote-22.png · 2,1 MB" onOpen={() => undefined} />
    </div>
  ),
};

export const Enviando: Story = {
  render: () => (
    <div className="flex flex-col gap-3 bg-[var(--bg-app)] p-4">
      <ImageMessage
        attachment={{ ...ready, state: "uploading", progress: 38 }}
        onOpen={() => undefined}
      />
    </div>
  ),
};

export const FalhouComRetry: Story = {
  render: () => (
    <div className="flex flex-col gap-3 bg-[var(--bg-app)] p-4">
      <ImageMessage attachment={{ ...ready, state: "error" }} onRetryUpload={() => undefined} />
    </div>
  ),
};

export const Indisponivel: Story = {
  render: () => (
    <div className="flex flex-col gap-3 bg-[var(--bg-app)] p-4">
      <ImageMessage attachment={{ ...ready, state: "unavailable" }} />
    </div>
  ),
};
