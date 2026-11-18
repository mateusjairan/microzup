import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConversationHeader } from "./ConversationHeader";

const meta: Meta<typeof ConversationHeader> = {
  title: "Chat/ConversationHeader",
  component: ConversationHeader,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Canal: Story = {
  render: () => (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
      <ConversationHeader
        kind="channel"
        title="Qualidade e Assuntos Regulatórios"
        memberCount={12}
        onlineCount={3}
        onToggleMute={() => undefined}
        onShowDetails={() => undefined}
        onOpenInWindow={() => undefined}
      />
    </div>
  ),
};

export const CanalSilenciadoEArquivado: Story = {
  render: () => (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
      <ConversationHeader
        kind="channel"
        title="Produção — turno noite"
        memberCount={8}
        onlineCount={0}
        muted
        archived
        onToggleMute={() => undefined}
      />
    </div>
  ),
};

export const DmComRecadoEPresenca: Story = {
  render: () => (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
      <ConversationHeader
        kind="dm"
        title="Ana Souza"
        peerPresence="busy"
        peerNote="Em auditoria até 14h"
        onToggleMute={() => undefined}
        onShowDetails={() => undefined}
        onOpenInWindow={() => undefined}
      />
    </div>
  ),
};

export const DmOffline: Story = {
  render: () => (
    <div className="w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)]">
      <ConversationHeader kind="dm" title="Carla Dias" peerPresence="offline" />
    </div>
  ),
};
