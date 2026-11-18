import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "UI/Switch",
  component: Switch,
};
export default meta;
type Story = StoryObj<typeof meta>;

function SwitchDemo({ initial }: { initial: boolean }) {
  const [checked, setChecked] = useState(initial);
  return (
    <label className="flex items-center gap-2 p-4">
      <Switch checked={checked} onCheckedChange={setChecked} label="Sons de notificação" />
      <span className="text-[length:var(--fs-body)] text-[var(--text)]">
        {checked ? "ligado" : "desligado"}
      </span>
    </label>
  );
}

export const Padrao: Story = {
  render: () => <SwitchDemo initial={false} />,
};

export const LigadoEDesabilitado: Story = {
  render: () => (
    <div className="flex items-center gap-4 p-4">
      <Switch checked onCheckedChange={() => undefined} label="Notificações" />
      <Switch checked={false} onCheckedChange={() => undefined} label="Bloqueado" disabled />
    </div>
  ),
};
