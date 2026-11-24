import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../ui/Button";
import { CommandPalette, type CommandItem } from "./CommandPalette";

const meta: Meta<typeof CommandPalette> = {
  title: "Chat/CommandPalette",
  component: CommandPalette,
};
export default meta;
type Story = StoryObj<typeof meta>;

const conversations: CommandItem[] = [
  { id: "c-1", kind: "conversation", title: "Qualidade e Assuntos Regulatórios", subtitle: "12 membros · 3 online" },
  { id: "c-2", kind: "conversation", title: "Produção", subtitle: "8 membros · 1 online" },
];

const people: CommandItem[] = [
  { id: "p-1", kind: "person", title: "Ana Souza", subtitle: "Qualidade", presence: "available" },
  { id: "p-2", kind: "person", title: "Bruno Lima", subtitle: "Produção", presence: "busy" },
  { id: "p-3", kind: "person", title: "Carla Dias", subtitle: "Almoxarifado", presence: "away" },
];

const messages: CommandItem[] = [
  {
    id: "m-1",
    kind: "message",
    title: "Ana Souza",
    subtitle: "Segue o desvio 045 em anexo para revisão do QA.",
  },
  {
    id: "m-2",
    kind: "message",
    title: "Bruno Lima",
    subtitle: "O lote 22 foi liberado após a conferência.",
  },
];

function PaletteDemo({
  loading = false,
  errorMessage = null,
  empty = false,
}: {
  loading?: boolean;
  errorMessage?: string | null;
  empty?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  return (
    <div className="flex h-[420px] w-[720px] flex-col items-start justify-end gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-app)] p-4">
      <p className="text-[length:var(--fs-meta)] text-[var(--text-3)]">
        ↑/↓ navega · Enter abre · Esc fecha (o foco volta ao campo)
      </p>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reabrir palette (Ctrl+K no produto)
      </Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        query={query}
        onQueryChange={setQuery}
        conversations={empty ? [] : conversations}
        people={empty ? [] : people}
        messages={empty ? [] : loading ? [] : messages}
        loading={loading}
        errorMessage={errorMessage}
        onOpenResult={() => setOpen(false)}
      />
    </div>
  );
}

export const TresGrupos: Story = {
  render: () => <PaletteDemo />,
};

export const CarregandoMensagens: Story = {
  render: () => <PaletteDemo loading />,
};

export const ErroNaBusca: Story = {
  render: () => <PaletteDemo errorMessage="servidor" />,
};

export const Vazio: Story = {
  render: () => <PaletteDemo empty />,
};
