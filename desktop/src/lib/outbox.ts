/**
 * Fila de envio persistida em disco (plano-frontend §8.1/§9).
 *
 * Quando o envio falha (offline ou 5xx), a entrada permanece na fila gravada
 * via IPC no processo main (electron-store) — no navegador, localStorage.
 * O retry reutiliza o MESMO client_id, então o servidor deduplica
 * (idempotência por conversation_id + client_id).
 *
 * A lógica de tentativa/envio vive no store (stores/app-store.ts); este módulo
 * é apenas a persistência + hidratação.
 */
import { loadOutbox, saveOutbox } from "./bridge";
import type { OutboxEntry } from "../types";

function isValidEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.clientId === "string" &&
    typeof entry.conversationId === "string" &&
    typeof entry.body === "string" &&
    Array.isArray(entry.attachmentIds) &&
    typeof entry.queuedAt === "number" &&
    typeof entry.attempts === "number"
  );
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const raw = await loadOutbox();
  return raw.filter(isValidEntry);
}

export async function persistOutbox(entries: OutboxEntry[]): Promise<void> {
  await saveOutbox(entries);
}

export async function clearOutbox(): Promise<void> {
  await saveOutbox([]);
}
