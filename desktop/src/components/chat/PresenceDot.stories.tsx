import type { Meta, StoryObj } from "@storybook/react-vite";
import { PresenceDot } from "./PresenceDot";

const meta: Meta<typeof PresenceDot> = {
  title: "Chat/PresenceDot",
  component: PresenceDot,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CincoStatusMaisOffline: Story = {
  render: () => (
    <div className="flex flex-col gap-2 bg-[var(--bg-sidebar)] p-4">
      {(["available", "busy", "away", "dnd", "invisible", "offline"] as const).map((status) => (
        <PresenceDot key={status} status={status} showLabel />
      ))}
    </div>
  ),
};

export const ComTextoNoCartao: Story = {
  render: () => (
    <div className="flex items-center gap-2 bg-[var(--bg-sidebar)] p-4">
      <PresenceDot status="busy" showLabel />
      <span className="text-[length:var(--fs-meta)] text-[var(--text-3)]">"Em auditoria até 14h"</span>
    </div>
  ),
};
