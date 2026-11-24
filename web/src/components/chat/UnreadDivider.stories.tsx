import type { Meta, StoryObj } from "@storybook/react-vite";
import { UnreadDivider } from "./UnreadDivider";

const meta: Meta<typeof UnreadDivider> = {
  title: "Chat/UnreadDivider",
  component: UnreadDivider,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const NovasMensagens: Story = {
  render: () => (
    <div className="w-[480px] bg-[var(--bg-app)] p-4">
      <UnreadDivider />
    </div>
  ),
};
