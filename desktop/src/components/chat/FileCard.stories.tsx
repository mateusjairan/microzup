import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileCard } from "./FileCard";
import type { ChatAttachment } from "./types";

const meta: Meta<typeof FileCard> = {
  title: "Chat/FileCard",
  component: FileCard,
};
export default meta;
type Story = StoryObj<typeof meta>;

const base: ChatAttachment = {
  id: "a-1",
  kind: "file",
  filename: "desvio-045.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2_202_009,
  state: "ready",
};

export const ProntoComDownload: Story = {
  render: () => (
    <div className="flex flex-col gap-2 bg-[var(--bg-app)] p-4">
      <FileCard attachment={base} onDownload={() => undefined} />
      <FileCard
        attachment={{ ...base, id: "a-2", filename: "lote-22.xlsx", mimeType: "application/vnd.ms-excel", sizeBytes: 84_320 }}
        onDownload={() => undefined}
      />
      <FileCard
        attachment={{ ...base, id: "a-3", filename: "evidencias-auditoria.zip", mimeType: "application/zip", sizeBytes: 58_720_114 }}
        onDownload={() => undefined}
      />
    </div>
  ),
};

export const UploadEmProgresso: Story = {
  render: () => (
    <div className="flex flex-col gap-2 bg-[var(--bg-app)] p-4">
      <FileCard
        attachment={{ ...base, id: "a-4", state: "uploading", progress: 64 }}
        onCancelUpload={() => undefined}
      />
    </div>
  ),
};

export const FalhaComRetry: Story = {
  render: () => (
    <div className="flex flex-col gap-2 bg-[var(--bg-app)] p-4">
      <FileCard
        attachment={{ ...base, id: "a-5", state: "error" }}
        onRetryUpload={() => undefined}
      />
    </div>
  ),
};

export const Indisponivel: Story = {
  render: () => (
    <div className="flex flex-col gap-2 bg-[var(--bg-app)] p-4">
      <FileCard attachment={{ ...base, id: "a-6", state: "unavailable" }} />
    </div>
  ),
};

export const Baixando: Story = {
  render: () => (
    <div className="flex flex-col gap-2 bg-[var(--bg-app)] p-4">
      <FileCard attachment={base} downloadProgress={42} onDownload={() => undefined} />
    </div>
  ),
};
