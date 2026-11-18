import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContactRow } from "./ContactRow";

const meta: Meta<typeof ContactRow> = {
  title: "Chat/ContactRow",
  component: ContactRow,
};
export default meta;
type Story = StoryObj<typeof meta>;

const MEN = [
  { name: "Ana Souza", presence: "available" as const, unread: 2 },
  { name: "Bruno Lima", presence: "busy" as const },
  { name: "Carla Dias", presence: "away" as const },
  { name: "Diego Reis", presence: "offline" as const },
];

export const Estados: Story = {
  render: () => (
    <div className="flex w-[280px] flex-col gap-1 bg-[var(--bg-sidebar)] p-2">
      {MEN.map((person, index) => (
        <ContactRow
          key={person.name}
          name={person.name}
          presence={person.presence}
          secondary={index === 0 ? "Segue o desvio 045 em anexo." : undefined}
          unread={person.unread}
          selected={index === 1}
          muted={index === 2}
          onClick={() => undefined}
        />
      ))}
    </div>
  ),
};

export const DigitandoEInativo: Story = {
  render: () => (
    <div className="flex w-[280px] flex-col gap-1 bg-[var(--bg-sidebar)] p-2">
      <ContactRow name="Elisa Prado" presence="available" typing secondary="Recebido. Vou conferir com o QA." />
      <ContactRow name="Fábio Nunes" inactive />
    </div>
  ),
};
