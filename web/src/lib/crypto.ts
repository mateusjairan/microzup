/**
 * Criptografia do lado do cliente: SHA-256 via WebCrypto para conferir
 * integridade de uploads/downloads, e geração de client_id idempotente.
 */

/** Gera um UUID v4 (crypto.randomUUID com fallback para contextos não seguros). */
export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex[4]}-${hex[5]}-${hex[6]}-${hex.slice(7).join("")}`;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** SHA-256 do conteúdo em hex minúsculo — mesmo formato que o servidor retorna. */
export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/** SHA-256 de um File sem carregar tudo em memória de uma vez (chunks de 4 MB). */
export async function sha256HexStreamed(file: File): Promise<string> {
  const CHUNK = 4 * 1024 * 1024;
  // SubtleCrypto não expõe hash incremental: juntamos os chunks em um buffer
  // único. Para o limite do MVP (100 MB) é aceitável e evita dependências.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const slice = file.slice(offset, offset + CHUNK);
    const buffer = await slice.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    total += buffer.byteLength;
  }
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.length;
  }
  return sha256Hex(merged);
}
