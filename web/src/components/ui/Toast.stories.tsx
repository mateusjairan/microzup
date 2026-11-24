import type { Meta, StoryObj } from "@storybook/react-vite";
import { useToast } from "../../app/ToastProvider";
import { Button } from "./Button";
import { ToastItem, ToastViewport, type ToastItemData } from "./Toast";

const meta = {
  title: "UI/Toast",
  component: ToastItem,
} satisfies Meta<typeof ToastItem>;
export default meta;
type Story = StoryObj<typeof meta>;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `story-toast-${counter}`;
}

const demoToasts: ToastItemData[] = [
  { id: nextId(), kind: "info", message: "Nova versão disponível no servidor." },
  { id: nextId(), kind: "success", message: "Arquivo enviado.", durationMs: 60_000 },
  { id: nextId(), kind: "error", message: "Falha ao enviar — verifique a conexão.", durationMs: 60_000 },
  { id: nextId(), kind: "info", message: "Ana chamou sua atenção.", actionLabel: "Abrir", durationMs: 60_000 },
];

export const OsQuatroTipos: Story = {
  args: { toast: demoToasts[0], onDismiss: () => undefined },
  render: () => (
    <div className="flex w-[420px] flex-col gap-2 p-4">
      <ToastViewport toasts={demoToasts} onDismiss={() => undefined} />
    </div>
  ),
};

function ToastDemo() {
  const { show } = useToast();
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <Button
        variant="secondary"
        onClick={() => show({ kind: "info", message: "Info: reconexão em curso." })}
      >
        Info
      </Button>
      <Button
        variant="secondary"
        onClick={() => show({ kind: "success", message: "Mensagem enviada." })}
      >
        Sucesso
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          show({
            kind: "error",
            message: "Não foi possível baixar o arquivo.",
            actionLabel: "Tentar de novo",
            onAction: () => show({ kind: "info", message: "Nova tentativa iniciada." }),
          })
        }
      >
        Erro com ação
      </Button>
    </div>
  );
}

export const InterativoComProvider: Story = {
  args: { toast: demoToasts[0], onDismiss: () => undefined },
  render: () => <ToastDemo />,
};
