import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar";
import { svgImage } from "../utils/storyFixtures";

const meta: Meta<typeof Avatar> = {
  title: "UI/Avatar",
  component: Avatar,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Iniciais: Story = {
  args: { name: "Ana Souza", size: 32 },
};

export const IniciaisComPresenca: Story = {
  args: { name: "Bruno Lima", size: 32, presence: "available" },
};

export const Escala: Story = {
  render: () => (
    <div className="flex items-end gap-3 bg-[var(--bg-app)] p-4">
      {([20, 24, 32, 40] as const).map((size) => (
        <Avatar key={size} name="Carla Dias" size={size} presence="dnd" />
      ))}
    </div>
  ),
};

export const ComFoto: Story = {
  args: {
    name: "Diego Reis",
    size: 40,
    presence: "busy",
    src: svgImage("#2563eb", "Diego"),
  },
};

export const FotoSemPresenca: Story = {
  args: { name: "Elisa Prado", size: 32, src: svgImage("#0f766e", "Elisa") },
};
