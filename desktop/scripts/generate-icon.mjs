/**
 * Gera o ícone do instalador (build/icon.ico) programaticamente — placeholder
 * decente: quadrado arredondado accent (#2563EB) com "M" branco, nas cores dos
 * tokens (plano-frontend §6). Também grava PNGs de conferência em build/.
 *
 * Uso: node scripts/generate-icon.mjs   (idempotente — sobrescreve)
 */
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(desktopDir, "build");

// ---------------------------------------------------------------------------
// Codificador PNG (mesmo algoritmo de electron/images.ts)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable = null;
function getCrcTable() {
  if (crcTable !== null) return crcTable;
  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = -1;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas mínimo
// ---------------------------------------------------------------------------

class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
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

  fillRoundedRect(x, y, w, h, radius, color) {
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        const dx = Math.max(radius - px, px - (w - 1 - radius), 0);
        const dy = Math.max(radius - py, py - (h - 1 - radius), 0);
        if (dx * dx + dy * dy <= radius * radius) this.set(x + px, y + py, color);
      }
    }
  }

  drawBitmap(rows, x, y, scale, color) {
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

  downsample(factor) {
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

  toPng() {
    return encodePng(this.width, this.height, this.data);
  }
}

const ACCENT = { r: 0x25, g: 0x63, b: 0xeb, a: 255 };
const ACCENT_HOVER = { r: 0x1d, g: 0x4e, b: 0xd8, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

const M_GLYPH = [
  "X.....X",
  "XX...XX",
  "X.X.X.X",
  "X..X..X",
  "X.....X",
  "X.....X",
];

function renderIcon(size) {
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

// ---------------------------------------------------------------------------
// Empacotador ICO (PNG-in-ICO, padrão Vista+ aceito pelo electron-builder)
// ---------------------------------------------------------------------------

function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // tipo ícone
  header.writeUInt16LE(count, 4);

  const entries = [];
  const offsets = [];
  let cursor = 6 + 16 * count;
  for (const { size, png } of pngs) {
    offsets.push(cursor);
    entries.push({ size, png });
    cursor += png.length;
  }

  const entryBuffers = pngs.map(({ size }, index) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 significa 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // paleta
    entry[3] = 0; // reservado
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(entries[index].png.length, 8);
    entry.writeUInt32LE(offsets[index], 12);
    return entry;
  });

  return Buffer.concat([header, ...entryBuffers, ...entries.map((e) => e.png)]);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256];

fs.mkdirSync(buildDir, { recursive: true });

const pngs = SIZES.map((size) => ({ size, png: renderIcon(size) }));
fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco(pngs));
fs.writeFileSync(path.join(buildDir, "icon-256.png"), pngs[pngs.length - 1].png);
fs.writeFileSync(path.join(buildDir, "tray-16.png"), renderIcon(16));

console.log(
  `[generate-icon] ${path.join("build", "icon.ico")} (${pngs.length} tamanhos: ${SIZES.join(", ")}) + PNGs de conferência`,
);
