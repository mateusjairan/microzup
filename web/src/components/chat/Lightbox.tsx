import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { formatFileSize, interpolate } from "../utils/format";
import { IconButton } from "../ui/Button";

export interface LightboxImage {
  src: string;
  /** Alternativa textual obrigatória para leitores de tela. */
  alt?: string;
  filename?: string;
  sizeBytes?: number;
}

export interface LightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload?: (image: LightboxImage) => void;
}

const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

/**
 * Lightbox (§5/§8.6): imagem em tela cheia, zoom (botões/teclado +/−/0),
 * anterior/próxima, baixar, Esc fecha, foco preso (Radix Dialog) e a11y
 * completa (título, rótulos, aria-valuetext da posição).
 */
export function Lightbox({ images, index, onIndexChange, onClose, onDownload }: LightboxProps) {
  const t = useI18n();
  const [zoomStep, setZoomStep] = useState(0);

  useEffect(() => {
    setZoomStep(0);
  }, [index]);

  if (images.length === 0) return null;
  const safeIndex = Math.min(Math.max(index, 0), images.length - 1);
  const image = images[safeIndex];
  if (!image) return null;
  const zoom = ZOOM_STEPS[Math.min(zoomStep, ZOOM_STEPS.length - 1)];

  const goPrevious = (): void => {
    if (safeIndex > 0) onIndexChange(safeIndex - 1);
  };
  const goNext = (): void => {
    if (safeIndex < images.length - 1) onIndexChange(safeIndex + 1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoomStep((step) => Math.min(step + 1, ZOOM_STEPS.length - 1));
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoomStep((step) => Math.max(step - 1, 0));
    } else if (event.key === "0") {
      event.preventDefault();
      setZoomStep(0);
    }
  };

  const captionParts = [
    image.filename,
    image.sizeBytes !== undefined ? formatFileSize(image.sizeBytes, t.format.units) : undefined,
  ].filter((part): part is string => part !== undefined);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[70] bg-[var(--overlay-heavy)]"
          style={{ animation: "mz-fade-in var(--motion-modal) var(--ease) both" }}
        />
        <DialogPrimitive.Content
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-[70] flex flex-col outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {interpolate(t.chat.lightbox.imageLabel, { index: safeIndex + 1, total: images.length })}
          </DialogPrimitive.Title>

          <div className="flex items-center justify-between gap-2 p-2">
            <p className="nums-tabular truncate px-2 text-[length:var(--fs-list)] text-[var(--text-2)]">
              {captionParts.join(" · ")}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                label={t.chat.lightbox.zoomOut}
                disabled={zoomStep === 0}
                onClick={() => setZoomStep((step) => Math.max(step - 1, 0))}
              >
                <ZoomOut size={16} strokeWidth={2} />
              </IconButton>
              <IconButton
                label={t.chat.lightbox.zoomIn}
                disabled={zoomStep === ZOOM_STEPS.length - 1}
                onClick={() => setZoomStep((step) => Math.min(step + 1, ZOOM_STEPS.length - 1))}
              >
                <ZoomIn size={16} strokeWidth={2} />
              </IconButton>
              <span
                aria-hidden="true"
                className="nums-tabular hidden w-10 text-center text-[length:var(--fs-meta)] text-[var(--text-2)] sm:inline"
              >
                {Math.round(zoom * 100)}%
              </span>
              {onDownload && (
                <IconButton label={t.chat.lightbox.download} onClick={() => onDownload(image)}>
                  <Download size={16} strokeWidth={2} />
                </IconButton>
              )}
              <DialogPrimitive.Close
                aria-label={t.ui.close}
                className="tz-colors flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
              >
                <X size={16} strokeWidth={2} />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-stretch">
            <button
              type="button"
              aria-label={t.chat.lightbox.previous}
              disabled={safeIndex === 0}
              onClick={goPrevious}
              className="tz-colors z-10 flex w-12 shrink-0 items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-white disabled:opacity-30"
            >
              <ArrowLeft size={20} strokeWidth={2} />
            </button>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
              <img
                src={image.src}
                alt={image.alt ?? image.filename ?? ""}
                className="tz-panel max-h-full max-w-full select-none"
                style={{ transform: `scale(${zoom})` }}
                draggable={false}
              />
            </div>
            <button
              type="button"
              aria-label={t.chat.lightbox.next}
              disabled={safeIndex === images.length - 1}
              onClick={goNext}
              className="tz-colors z-10 flex w-12 shrink-0 items-center justify-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-white disabled:opacity-30"
            >
              <ArrowRight size={20} strokeWidth={2} />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
