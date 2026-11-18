import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

const meta: Meta<typeof Dialog> = {
  title: "UI/Dialog",
  component: Dialog,
};
export default meta;
type Story = StoryObj<typeof meta>;

function DialogDemo(props: { title: string; description?: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4">
      <Button onClick={() => setOpen(true)}>Abrir diálogo</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={props.title}
        description={props.description}
        size={props.size}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => setOpen(false)}>Confirmar</Button>
          </>
        }
      >
        <p className="text-[length:var(--fs-body)] leading-[var(--lh-body)] text-[var(--text-2)]">
          Foco preso ao diálogo; Esc fecha; o foco volta ao acionar quando fecha.
        </p>
      </Dialog>
    </div>
  );
}

export const Medio: Story = {
  render: () => <DialogDemo title="Silenciar conversa?" description="Você continuará recebendo as mensagens, sem toast nem som." />,
};

export const Pequeno: Story = {
  render: () => <DialogDemo title="Apagar mensagem" size="sm" />,
};
