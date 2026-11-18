import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, Send } from "lucide-react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "UI/Button",
  component: Button,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Variacoes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Button variant="primary">Primário</Button>
      <Button variant="secondary">Secundário</Button>
      <Button variant="ghost">Fantasma</Button>
      <Button variant="danger">Perigo</Button>
    </div>
  ),
};

export const Tamanhos: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary">Pequeno</Button>
      <Button size="md" variant="secondary">Médio</Button>
    </div>
  ),
};

export const Carregando: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Button loading>Enviando</Button>
      <Button variant="secondary" loading>Testando conexão</Button>
    </div>
  ),
};

export const Desabilitado: Story = {
  render: () => <Button disabled>Indisponível</Button>,
};

export const ComIcone: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Button icon={<Send size={14} strokeWidth={2} />}>Enviar</Button>
      <Button variant="secondary" icon={<Download size={14} strokeWidth={2} />}>Baixar</Button>
    </div>
  ),
};
