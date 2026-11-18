import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./Skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "UI/Skeleton",
  component: Skeleton,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const ListaDeContatos: Story = {
  render: () => (
    <div className="w-[280px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-sidebar)] p-3">
      <Skeleton variant="list" rows={6} />
    </div>
  ),
};

export const Mensagens: Story = {
  render: () => (
    <div className="h-[320px] w-[480px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-app)] p-3">
      <Skeleton variant="message" rows={4} />
    </div>
  ),
};

export const PainelDeDetalhes: Story = {
  render: () => (
    <div className="h-[360px] w-[260px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <Skeleton variant="details" rows={4} />
    </div>
  ),
};

export const Generico: Story = {
  render: () => (
    <div className="w-[280px] p-2">
      <Skeleton variant="generic" />
    </div>
  ),
};
