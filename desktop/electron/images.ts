/**
 * Renderização de imagens nativas sem dependências externas.
 *
 * O Electron só carrega PNG/JPEG a partir de buffers — então aqui vive um
 * codificador PNG mínimo (zlib + CRC32) e desenhistas de pixel para:
 *  - ícone da bandeja (M sobre quadrado arredondado, com/sem ponto de não lidas);
 *  - badge de overlay na barra de tarefas (círculo vermelho + dígitos).
 *
 * O ícone do INSTALADOR (build/icon.ico) é gerado por scripts/generate-icon.mjs
 * usando o mesmo algoritmo.
 */
import { deflateSync } from "node:zlib";
import { nativeImage } from "electron";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Int32Array | null = null;

function getCrcTable(): Int32Array {
  if (crcTable !== null) return crcTable;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  crcTable = table;
  return table;
}

function crc32(buffer: Buffer): number {
  const table = getCrcTable();
  let crc = -1;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Codifica RGBA (linha a linha, sem filtro) em PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adaptativo off
  ihdr[12] = 0; // sem interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Canvas RGBA em memória, transparente por padrão. */
class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    // Alpha compõe (para contornos sobrepostos ficarem corretos).
    const srcA = color.a / 255;
    const dstA = this.data[index + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      const src = channel === 0 ? color.r : channel === 1 ? color.g : color.b;
      const dst = this.data[index + channel];
      this.data[index + channel] = Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
    }
    this.data[index + 3] = Math.round(outA * 255);
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, radius: number, color: Rgba): void {
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        // distância do canto mais próximo (dentro do retângulo dos raios)
        const dx = Math.max(radius - px, px - (w - 1 - radius), 0);
        const dy = Math.max(radius - py, py - (h - 1 - radius), 0);
        if (dx * dx + dy * dy <= radius * radius) {
          this.set(x + px, y + py, color);
        }
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, color: Rgba): void {
    for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py += 1) {
      for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px += 1) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          this.set(px, py, color);
        }
      }
    }
  }

  /** Desenha um glifo bitmap ("X" pinta, "." ignora) com escala inteira. */
  drawBitmap(rows: string[], x: number, y: number, scale: number, color: Rgba): void {
    rows.forEach((row, rowIndex) => {
      for (let charIndex = 0; charIndex < row.length; charIndex += 1) {
        if (row[charIndex] !== "X") continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            this.set(x + charIndex * scale + sx, y + rowIndex * scale + sy, color);
          }
        }
      }
    });
  }

  /** Reduz por fator inteiro com filtro de caixa (antialiasing barato). */
  downsample(factor: number): PixelCanvas {
    const width = Math.floor(this.width / factor);
    const height = Math.floor(this.height / factor);
    const out = new PixelCanvas(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < factor; sy += 1) {
          for (let sx = 0; sx < factor; sx += 1) {
            const index = ((y * factor + sy) * this.width + (x * factor + sx)) * 4;
            const alpha = this.data[index + 3];
            r += this.data[index] * alpha;
            g += this.data[index + 1] * alpha;
            b += this.data[index + 2] * alpha;
            a += alpha;
          }
        }
        const total = factor * factor;
        const outIndex = (y * width + x) * 4;
        if (a > 0) {
          out.data[outIndex] = Math.round(r / a);
          out.data[outIndex + 1] = Math.round(g / a);
          out.data[outIndex + 2] = Math.round(b / a);
        }
        out.data[outIndex + 3] = Math.round(a / total);
      }
    }
    return out;
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}

// Cores dos tokens (plano-frontend §6): accent, danger e branco.
const ACCENT: Rgba = { r: 0x25, g: 0x63, b: 0xeb, a: 255 };
const ACCENT_HOVER: Rgba = { r: 0x1d, g: 0x4e, b: 0xd8, a: 255 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const DANGER: Rgba = { r: 0xdc, g: 0x26, b: 0x26, a: 255 };

const M_GLYPH = [
  "X.....X",
  "XX...XX",
  "X.X.X.X",
  "X..X..X",
  "X.....X",
  "X.....X",
];

const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "011", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

const PLUS_GLYPH = ["000", "010", "111", "010", "000"];

/** Ícone da bandeja: M branco sobre quadrado arredondado accent. */
export function renderTrayIconPng(size: number, withDot: boolean): Buffer {
  const ss = 2; // supersampling para bordas decentes
  const canvas = new PixelCanvas(size * ss, size * ss);
  const big = size * ss;
  const radius = Math.round(big * 0.3);
  canvas.fillRoundedRect(0, 0, big, big, radius, ACCENT);
  // Sombra sutil de "hover" no terço inferior para dar profundidade.
  canvas.fillRoundedRect(
    Math.round(big * 0.08),
    Math.round(big * 0.52),
    Math.round(big * 0.84),
    Math.round(big * 0.4),
    Math.round(radius * 0.8),
    ACCENT_HOVER,
  );
  const glyphWidth = M_GLYPH[0].length;
  const glyphHeight = M_GLYPH.length;
  const glyphScale = Math.max(1, Math.floor((big * 0.62) / glyphWidth));
  const mx = Math.round((big - glyphWidth * glyphScale) / 2);
  const my = Math.round((big - glyphHeight * glyphScale) / 2);
  canvas.drawBitmap(M_GLYPH, mx, my, glyphScale, WHITE);
  if (withDot) {
    const dotRadius = Math.round(big * 0.22);
    const dotX = big - dotRadius - Math.round(big * 0.06);
    const dotY = big - dotRadius - Math.round(big * 0.06);
    canvas.fillCircle(dotX, dotY, dotRadius + ss, WHITE);
    canvas.fillCircle(dotX, dotY, dotRadius, DANGER);
  }
  return canvas.downsample(ss).toPng();
}

/** Ícone do app (mesma cara do tray, full-bleed) em PNG. */
export function renderAppIconPng(size: number): Buffer {
  const ss = 4;
  const big = size * ss;
  const canvas = new PixelCanvas(big, big);
  const radius = Math.round(big * 0.19);
  canvas.fillRoundedRect(0, 0, big, big, radius, ACCENT);
  canvas.fillRoundedRect(
    Math.round(big * 0.06),
    Math.round(big * 0.55),
    Math.round(big * 0.88),
    Math.round(big * 0.39),
    Math.round(radius * 0.85),
    ACCENT_HOVER,
  );
  const glyphScale = Math.max(1, Math.floor((big * 0.58) / M_GLYPH[0].length));
  const mx = Math.round((big - M_GLYPH[0].length * glyphScale) / 2);
  const my = Math.round((big - M_GLYPH.length * glyphScale) / 2);
  canvas.drawBitmap(M_GLYPH, mx, my, glyphScale, WHITE);
  return canvas.downsample(ss).toPng();
}

/** Badge de overlay (16×16): círculo vermelho com contagem (1-9 / "9+"). */
export function renderBadgePng(count: number): Buffer {
  const ss = 2;
  const size = 16;
  const big = size * ss;
  const canvas = new PixelCanvas(big, big);
  canvas.fillCircle(big / 2, big / 2, big / 2 - ss, DANGER);
  const label = count >= 10 ? "9+" : String(Math.max(1, Math.min(9, count)));
  const glyphs = [...label].map((char) => (char === "+" ? PLUS_GLYPH : DIGITS[char]));
  const glyphWidth = glyphs.reduce((sum, glyph) => sum + glyph[0].length + 1, -1);
  const scale = ss; // 3×5 px por dígito
  let x = Math.round((big - glyphWidth * scale) / 2);
  for (const glyph of glyphs) {
    canvas.drawBitmap(glyph, x, Math.round((big - 5 * scale) / 2), scale, WHITE);
    x += (glyph[0].length + 1) * scale;
  }
  return canvas.downsample(ss).toPng();
}

/** nativeImage da bandeja com representações 1x/2x. */
export function trayImage(withDot: boolean): Electron.NativeImage {
  const image = nativeImage.createFromBuffer(renderTrayIconPng(16, withDot));
  image.addRepresentation({
    scaleFactor: 2,
    buffer: renderTrayIconPng(32, withDot),
    width: 32,
    height: 32,
  });
  return image;
}

/** nativeImage do badge de overlay da barra de tarefas. */
export function badgeImage(count: number): Electron.NativeImage {
  return nativeImage.createFromBuffer(renderBadgePng(count));
}
