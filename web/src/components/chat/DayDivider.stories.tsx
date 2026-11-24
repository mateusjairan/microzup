import type { Meta, StoryObj } from "@storybook/react-vite";
import { DayDivider } from "./DayDivider";
import { isoDaysAgo, isoMinutesAgo } from "../utils/storyFixtures";

const meta: Meta<typeof DayDivider> = {
  title: "Chat/DayDivider",
  component: DayDivider,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const HojeOntemEDataCompleta: Story = {
  render: () => (
    <div className="flex w-[480px] flex-col gap-1 bg-[var(--bg-app)] p-4">
      <DayDivider iso={isoMinutesAgo(30)} />
      <DayDivider iso={isoDaysAgo(1)} />
      <DayDivider iso={isoDaysAgo(21)} />
    </div>
  ),
};
