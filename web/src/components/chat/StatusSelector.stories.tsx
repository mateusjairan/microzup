import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusSelector } from "./StatusSelector";
import { useI18n } from "../../app/I18nProvider";
import { Avatar } from "../ui/Avatar";
import type { PresenceStatus } from "../ui/presence";

const meta: Meta<typeof StatusSelector> = {
  title: "Chat/StatusSelector",
  component: StatusSelector,
};
export default meta;
type Story = StoryObj<typeof meta>;

function StatusSelectorDemo({
  initialStatus,
  initialNote,
}: {
  initialStatus: PresenceStatus;
  initialNote: string;
}) {
  const t = useI18n();
  const [status, setStatus] = useState<PresenceStatus>(initialStatus);
  const [note, setNote] = useState(initialNote);
  return (
    <div className="flex w-[300px] flex-col gap-2 bg-[var(--bg-sidebar)] p-4">
      <div className="flex items-center gap-2">
        <Avatar name="Ana Souza" size={32} presence={status} />
        <div className="flex flex-col">
          <span className="text-[length:var(--fs-list)] font-semibold text-[var(--text)]">Ana Souza</span>
          <StatusSelector
            status={status}
            note={note}
            onStatusChange={setStatus}
            onNoteChange={setNote}
            trigger={
              <button
                type="button"
                className="tz-colors flex min-h-8 items-center gap-1.5 self-start rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[var(--bg-hover)]"
              >
                <span className="text-[length:var(--fs-list)] text-[var(--text-2)]">{t.status[status]}</span>
              </button>
            }
          />
        </div>
      </div>
      {note.length > 0 && (
        <p className="text-[length:var(--fs-meta)] text-[var(--text-3)]">Recado: {note}</p>
      )}
    </div>
  );
}

export const ComRecadoAtivo: Story = {
  render: () => <StatusSelectorDemo initialStatus="available" initialNote="Em auditoria até 14h" />,
};

export const Invisivel: Story = {
  render: () => <StatusSelectorDemo initialStatus="invisible" initialNote="" />,
};

export const NaoPerturbe: Story = {
  render: () => <StatusSelectorDemo initialStatus="dnd" initialNote="" />,
};
