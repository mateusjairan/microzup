import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Composer, type ComposerProps } from "./Composer";
import type { PendingAttachment } from "./types";

const meta: Meta<typeof Composer> = {
  title: "Chat/Composer",
  component: Composer,
};
export default meta;
type Story = StoryObj<typeof meta>;

function ComposerDemo({
  initialValue = "",
  ...rest
}: { initialValue?: string } & Partial<ComposerProps>) {
  const [value, setValue] = useState<string>(initialValue);
  return (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <Composer
        value={value}
        onChange={setValue}
        onSend={(text) => {
          setValue("");
          window.alert(`Enviado: ${text}`);
        }}
        onAttach={() => window.alert("Anexar arquivo (Ctrl+O no produto)")}
        onNudge={() => window.alert("Chamar atenção (1×/5 min)")}
        {...rest}
      />
    </div>
  );
}

export const Basico: Story = {
  render: () => <ComposerDemo />,
};

export const PertoDoLimite: Story = {
  render: () => <ComposerDemo initialValue={"a".repeat(7_520)} />,
};

export const ModoEdicao: Story = {
  render: () => <ComposerDemo value="Texto da última mensagem, pronto para revisar." editing onCancelEdit={() => undefined} />,
};

export const NaoPodeChamarAtencao: Story = {
  render: () => <ComposerDemo canNudge={false} />,
};

export const SomenteLeitura: Story = {
  render: () => <ComposerDemo disabledReason="Conversa arquivada — somente leitura" />,
};

const pending: PendingAttachment[] = [
  { id: "p-1", filename: "desvio-045.pdf", sizeBytes: 2_202_009, state: "uploading", progress: 64 },
  { id: "p-2", filename: "lote-22.png", sizeBytes: 2_202_009, state: "queued" },
  { id: "p-3", filename: "parecer-qa.xlsx", sizeBytes: 84_320, state: "error" },
];

export const ComAnexosPendentes: Story = {
  render: () => (
    <ComposerDemo
      pendingAttachments={pending}
      onRemoveAttachment={() => undefined}
      onCancelUpload={() => undefined}
      onRetryUpload={() => undefined}
    />
  ),
};

export const ArrastandoArquivo: Story = {
  render: () => <ComposerDemo isDragActive />,
};
