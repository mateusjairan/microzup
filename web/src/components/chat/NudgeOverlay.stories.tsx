import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../ui/Button";
import { NudgeOverlay } from "./NudgeOverlay";

const meta: Meta<typeof NudgeOverlay> = {
  title: "Chat/NudgeOverlay",
  component: NudgeOverlay,
};
export default meta;
type Story = StoryObj<typeof meta>;

function NudgeDemo() {
  const [active, setActive] = useState(false);
  return (
    <div className="relative flex h-[360px] w-[620px] flex-col items-start justify-end gap-2 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-app)] p-4">
      <Button
        variant="secondary"
        onClick={() => {
          setActive(false);
          window.setTimeout(() => setActive(true), 50);
        }}
      >
        Simular “chamar atenção”
      </Button>
      <NudgeOverlay active={active} senderName="Ana Souza" onDismiss={() => setActive(false)} />
    </div>
  );
}

export const FlashEAviso: Story = {
  render: () => <NudgeDemo />,
};

export const AvisoPersistente: Story = {
  render: () => (
    <div className="relative flex h-[360px] w-[620px] items-start justify-end overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-app)]">
      <NudgeOverlay active senderName="Bruno Lima" onDismiss={() => undefined} />
    </div>
  ),
};
