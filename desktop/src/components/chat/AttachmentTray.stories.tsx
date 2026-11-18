import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttachmentTray } from "./AttachmentTray";
import type { PendingAttachment } from "./types";

const meta: Meta<typeof AttachmentTray> = {
  title: "Chat/AttachmentTray",
  component: AttachmentTray,
};
export default meta;
type Story = StoryObj<typeof meta>;

const items: PendingAttachment[] = [
  { id: "p-1", filename: "desvio-045.pdf", sizeBytes: 2_202_009, state: "uploading", progress: 82 },
  { id: "p-2", filename: "lote-22.png", sizeBytes: 2_202_009, state: "queued" },
  { id: "p-3", filename: "parecer-qa.xlsx", sizeBytes: 84_320, state: "error" },
];

export const EstadosDaFila: Story = {
  render: () => (
    <div className="flex w-[480px] flex-col gap-1 bg-[var(--bg-surface)] p-3">
      <AttachmentTray
        items={items}
        onRemove={() => undefined}
        onCancel={() => undefined}
        onRetry={() => undefined}
      />
    </div>
  ),
};

export const Vazia: Story = {
  render: () => (
    <div className="flex w-[480px] flex-col gap-1 bg-[var(--bg-surface)] p-3">
      <AttachmentTray items={[]} />
    </div>
  ),
};
