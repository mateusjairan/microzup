import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchField } from "./SearchField";

const meta: Meta<typeof SearchField> = {
  title: "Chat/SearchField",
  component: SearchField,
};
export default meta;
type Story = StoryObj<typeof meta>;

function SearchFieldDemo({ debounceMs = 300 }: { debounceMs?: number }) {
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  return (
    <div className="flex w-[360px] flex-col gap-2 p-4">
      <SearchField
        value={value}
        onChange={setValue}
        onDebouncedChange={setDebounced}
        debounceMs={debounceMs}
        placeholder="Buscar no setor…"
      />
      <p className="text-[length:var(--fs-meta)] text-[var(--text-3)]">
        Instantâneo: “{value}” · Debounced: “{debounced}”
      </p>
    </div>
  );
}

export const ComDebounce: Story = {
  render: () => <SearchFieldDemo />,
};

export const SemDebounce: Story = {
  render: () => <SearchFieldDemo debounceMs={0} />,
};
