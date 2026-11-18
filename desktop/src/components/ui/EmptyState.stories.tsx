import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, Search } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

const meta: Meta<typeof EmptyState> = {
  title: "UI/EmptyState",
  component: EmptyState,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const SemMensagens: Story = {
  render: () => (
    <div className="h-[300px] w-[420px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <EmptyState icon={<Inbox size={24} strokeWidth={1.75} />} title="Nenhuma mensagem aqui ainda." />
    </div>
  ),
};

export const SemResultadosComAcao: Story = {
  render: () => (
    <div className="h-[300px] w-[420px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
      <EmptyState
        icon={<Search size={24} strokeWidth={1.75} />}
        title="Nenhum resultado para “desvio”"
        hint="Tente buscar por pessoa, setor ou outra palavra."
        action={<Button size="sm">Limpar busca</Button>}
      />
    </div>
  ),
};
