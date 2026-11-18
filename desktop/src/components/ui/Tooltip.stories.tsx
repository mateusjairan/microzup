import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "UI/Tooltip",
  component: Tooltip,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const HorarioDaEdicao: Story = {
  render: () => (
    <div className="p-8">
      <Tooltip label="Editada em 18/11/2026 09:43">
        <button
          type="button"
          className="tz-colors h-9 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[length:var(--fs-body)] text-[var(--text-2)]"
        >
          Passa o mouse (ou foca com Tab)
        </button>
      </Tooltip>
    </div>
  ),
};
