import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Hash } from "lucide-react";
import { SidebarGroup } from "./SidebarGroup";
import { UnreadBadge } from "../ui/UnreadBadge";

const meta: Meta<typeof SidebarGroup> = {
  title: "Chat/SidebarGroup",
  component: SidebarGroup,
};
export default meta;
type Story = StoryObj<typeof meta>;

const SETORES = ["Qualidade e Assuntos Regulatórios", "Produção", "Almoxarifado"];

function SidebarDemo({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [collapsedConversations, setCollapsedConversations] = useState(false);
  return (
    <div className="flex w-[280px] flex-col gap-3 bg-[var(--bg-sidebar)] p-3">
      <SidebarGroup
        title="Setores"
        count={SETORES.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      >
        {SETORES.map((sector, index) => (
          <div key={sector} className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-hover)]">
            <Hash size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--text-3)]" />
            <span className="flex-1 truncate text-[length:var(--fs-list)] text-[var(--text)]">{sector}</span>
            {index === 0 && <UnreadBadge count={3} />}
          </div>
        ))}
      </SidebarGroup>
      <SidebarGroup
        title="Conversas"
        collapsed={collapsedConversations}
        onToggle={() => setCollapsedConversations((value) => !value)}
      >
        {["Ana Souza", "Bruno Lima", "Carla Dias"].map((name, index) => (
          <div key={name} className="flex h-8 items-center justify-between rounded-[var(--radius-sm)] px-2 hover:bg-[var(--bg-hover)]">
            <span className="text-[length:var(--fs-list)] text-[var(--text)]">{name}</span>
            {index === 0 && <UnreadBadge count={2} />}
          </div>
        ))}
      </SidebarGroup>
    </div>
  );
}

export const Expandido: Story = {
  render: () => <SidebarDemo initialCollapsed={false} />,
};

export const Colapsado: Story = {
  render: () => <SidebarDemo initialCollapsed={true} />,
};
