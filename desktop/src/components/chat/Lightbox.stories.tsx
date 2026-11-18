import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../ui/Button";
import { Lightbox, type LightboxImage } from "./Lightbox";
import { svgImage } from "../utils/storyFixtures";

const meta: Meta<typeof Lightbox> = {
  title: "Chat/Lightbox",
  component: Lightbox,
};
export default meta;
type Story = StoryObj<typeof meta>;

const gallery: LightboxImage[] = [
  { src: svgImage("#2563eb", "lote-22"), alt: "Foto do lote 22", filename: "lote-22.png", sizeBytes: 2_202_009 },
  { src: svgImage("#0f766e", "reclamacao-07"), alt: "Registro da reclamação 07", filename: "reclamacao-07.jpg", sizeBytes: 1_204_112 },
  { src: svgImage("#7c3aed", "quadro-branco"), alt: "Quadro branco da reunião", filename: "quadro-branco.png", sizeBytes: 3_301_744 },
];

function LightboxDemo({ images }: { images: LightboxImage[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <Button
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        Abrir lightbox
      </Button>
      {open && (
        <Lightbox
          images={images}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setOpen(false)}
          onDownload={() => undefined}
        />
      )}
    </div>
  );
}

export const GaleriaComZoom: Story = {
  render: () => <LightboxDemo images={gallery} />,
};

export const ImagemUnica: Story = {
  render: () => <LightboxDemo images={[gallery[0]]} />,
};
