import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ellipsis, PenLine, Trash } from "lucide-react";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "./Dropdown";

const meta = {
  title: "UI/Dropdown",
  component: Dropdown,
} satisfies Meta<typeof Dropdown>;
export default meta;
type Story = StoryObj<typeof meta>;

const messageMenu = (
  <>
    <DropdownLabel>Ações</DropdownLabel>
    <DropdownItem icon={<PenLine size={14} strokeWidth={2} />}>Editar</DropdownItem>
    <DropdownSeparator />
    <DropdownItem danger icon={<Trash size={14} strokeWidth={2} />}>Apagar</DropdownItem>
  </>
);

const ellipsisTrigger = (
  <button
    type="button"
    className="tz-colors flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-2)]"
  >
    <Ellipsis size={16} strokeWidth={2} />
  </button>
);

export const MenuDeMensagem: Story = {
  args: { trigger: ellipsisTrigger, children: messageMenu },
  render: (args) => (
    <div className="p-8">
      <Dropdown {...args} />
    </div>
  ),
};

export const ComMarcadoEDesabilitado: Story = {
  args: {
    trigger: (
      <button
        type="button"
        className="tz-colors flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[length:var(--fs-list)] text-[var(--text-2)]"
      >
        Opções
      </button>
    ),
    children: (
      <>
        <DropdownItem checked>Disponível</DropdownItem>
        <DropdownItem>Ocupado</DropdownItem>
        <DropdownItem disabled>Ausente (indisponível)</DropdownItem>
      </>
    ),
  },
  render: (args) => (
    <div className="p-8">
      <Dropdown {...args} />
    </div>
  ),
};
