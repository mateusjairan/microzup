import type { Meta, StoryObj } from "@storybook/react-vite";
import { UnreadBadge } from "./UnreadBadge";

const meta: Meta<typeof UnreadBadge> = {
  title: "UI/UnreadBadge",
  component: UnreadBadge,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Faixa: Story = {
  render: () => (
    <div className="flex items-center gap-2 p-4">
      <UnreadBadge count={1} />
      <UnreadBadge count={7} />
      <UnreadBadge count={42} />
      <UnreadBadge count={99} />
      <UnreadBadge count={173} />
    </div>
  ),
};

export const NaLinhaDeContato: Story = {
  render: () => (
    <div className="flex w-[260px] flex-col gap-1 p-2">
      <div className="flex h-8 items-center justify-between rounded-[var(--radius-sm)] bg-[var(--bg-selected)] px-2">
        <span className="text-[length:var(--fs-list)] text-[var(--text)]">Ana Souza</span>
        <UnreadBadge count={12} />
      </div>
      <div className="flex h-8 items-center justify-between rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-hover)]">
        <span className="text-[length:var(--fs-list)] text-[var(--text)]">Bruno Lima</span>
        <UnreadBadge count={1} />
      </div>
      <div className="flex h-8 items-center justify-between rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-hover)]">
        <span className="text-[length:var(--fs-list)] text-[var(--text)]">Carla Dias</span>
      </div>
    </div>
  ),
};
