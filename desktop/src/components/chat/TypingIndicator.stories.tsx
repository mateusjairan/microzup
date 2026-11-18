import type { Meta, StoryObj } from "@storybook/react-vite";
import { TypingIndicator } from "./TypingIndicator";

const meta: Meta<typeof TypingIndicator> = {
  title: "Chat/TypingIndicator",
  component: TypingIndicator,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const UmaPessoa: Story = {
  render: () => (
    <div className="w-[480px] bg-[var(--bg-app)]">
      <TypingIndicator people={[{ id: "u-ana", name: "Ana Souza" }]} />
    </div>
  ),
};

export const DuasPessoas: Story = {
  render: () => (
    <div className="w-[480px] bg-[var(--bg-app)]">
      <TypingIndicator
        people={[
          { id: "u-ana", name: "Ana Souza" },
          { id: "u-bruno", name: "Bruno Lima" },
        ]}
      />
    </div>
  ),
};

export const TresPessoas: Story = {
  render: () => (
    <div className="w-[480px] bg-[var(--bg-app)]">
      <TypingIndicator
        people={[
          { id: "u-ana", name: "Ana Souza" },
          { id: "u-bruno", name: "Bruno Lima" },
          { id: "u-carla", name: "Carla Dias" },
        ]}
      />
    </div>
  ),
};

export const VariasPessoas: Story = {
  render: () => (
    <div className="w-[480px] bg-[var(--bg-app)]">
      <TypingIndicator
        people={[
          { id: "u-ana", name: "Ana Souza" },
          { id: "u-bruno", name: "Bruno Lima" },
          { id: "u-carla", name: "Carla Dias" },
          { id: "u-diego", name: "Diego Reis" },
        ]}
      />
    </div>
  ),
};

export const Ninguem: Story = {
  render: () => (
    <div className="w-[480px] bg-[var(--bg-app)]">
      <TypingIndicator people={[]} />
    </div>
  ),
};
