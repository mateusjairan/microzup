import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReconnectBanner } from "./ReconnectBanner";

const meta: Meta<typeof ReconnectBanner> = {
  title: "Chat/ReconnectBanner",
  component: ReconnectBanner,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Reconectando: Story = {
  render: () => (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
      <ReconnectBanner state="connecting" attempt={2} onTryNow={() => undefined} />
      <div className="h-[120px] bg-[var(--bg-app)]" />
    </div>
  ),
};

export const SemConexao: Story = {
  render: () => (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
      <ReconnectBanner state="offline" onTryNow={() => undefined} />
      <div className="h-[120px] bg-[var(--bg-app)]" />
    </div>
  ),
};
