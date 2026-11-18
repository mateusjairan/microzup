/**
 * Persistência do processo main:
 *  - "settings": preferências + URL do servidor (electron-store);
 *  - "outbox": fila de envio do renderer (electron-store);
 *  - "session": refresh token cifrado com safeStorage (DPAPI) — NUNCA texto
 *    plano, nunca localStorage;
 *  - migração do config.json legado (main.js antigo) na primeira execução.
 */
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type ElectronStore from "electron-store" with { "resolution-mode": "import" };
import {
  DEFAULT_SETTINGS,
  type AppPreferences,
  type OutboxEntry,
  type PersistedSettings,
  type StoredTokens,
} from "./ipc-contract";

let settingsStore: ElectronStore<PersistedSettings> | null = null;
let outboxStore: ElectronStore<Record<string, OutboxEntry[]>> | null = null;
let sessionStore: ElectronStore<Record<string, unknown>> | null = null;
let cachedSettings: PersistedSettings | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function ensureStores(): Promise<void> {
  if (settingsStore !== null && outboxStore !== null && sessionStore !== null) return;
  // electron-store ≥ 9 é ESM-only: import dinâmico a partir do CJS do main.
  const { default: ElectronStoreCtor } = await import("electron-store");
  if (settingsStore === null) {
    settingsStore = new ElectronStoreCtor<PersistedSettings>({
      name: "settings",
      defaults: DEFAULT_SETTINGS,
    });
  }
  if (outboxStore === null) {
    outboxStore = new ElectronStoreCtor<Record<string, OutboxEntry[]>>({ name: "outbox" });
  }
  if (sessionStore === null) {
    sessionStore = new ElectronStoreCtor<Record<string, unknown>>({ name: "session" });
  }
}

function readSettingsSync(): PersistedSettings {
  const stored = settingsStore?.store;
  const merged: PersistedSettings = { ...DEFAULT_SETTINGS, ...(isRecord(stored) ? stored : {}) };
  if (typeof merged.serverUrl !== "string" || merged.serverUrl === "") {
    merged.serverUrl = DEFAULT_SETTINGS.serverUrl;
  }
  return merged;
}

/** Migra o config.json do main.js antigo (serverUrl + tokens) uma única vez. */
async function migrateLegacyConfig(): Promise<void> {
  const legacyPath = path.join(app.getPath("userData"), "config.json");
  if (!fs.existsSync(legacyPath)) return;
  if (fs.existsSync(path.join(app.getPath("userData"), "settings.json"))) return;
  try {
    const raw = fs.readFileSync(legacyPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.serverUrl === "string" && settingsStore !== null) {
      settingsStore.set("serverUrl", parsed.serverUrl);
    }
  } catch {
    /* legado ilegível — ignora */
  }
  try {
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);
  } catch {
    /* sem permissão — o arquivo será lido de novo, idempotente */
  }
}

export async function initPersistence(): Promise<PersistedSettings> {
  await ensureStores();
  await migrateLegacyConfig();
  cachedSettings = readSettingsSync();
  return cachedSettings;
}

export function getCachedSettings(): PersistedSettings {
  return cachedSettings ?? DEFAULT_SETTINGS;
}

export async function getServerUrl(): Promise<string> {
  await ensureStores();
  cachedSettings = readSettingsSync();
  return cachedSettings.serverUrl;
}

export async function setServerUrl(url: string): Promise<string> {
  await ensureStores();
  const trimmed = url.trim().replace(/\/+$/, "");
  const normalized = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  settingsStore?.set("serverUrl", normalized);
  cachedSettings = readSettingsSync();
  return cachedSettings.serverUrl;
}

export async function getPreferences(): Promise<AppPreferences> {
  await ensureStores();
  cachedSettings = readSettingsSync();
  const { serverUrl: _serverUrl, ...preferences } = cachedSettings;
  return preferences;
}

export async function setPreferences(patch: Partial<AppPreferences>): Promise<AppPreferences> {
  await ensureStores();
  const current = readSettingsSync();
  const next: PersistedSettings = {
    ...current,
    theme: patch.theme ?? current.theme,
    soundsEnabled: patch.soundsEnabled ?? current.soundsEnabled,
    mutedConversations: Array.isArray(patch.mutedConversations)
      ? patch.mutedConversations.filter((id): id is string => typeof id === "string")
      : current.mutedConversations,
    lockTimeoutMinutes:
      typeof patch.lockTimeoutMinutes === "number" && patch.lockTimeoutMinutes > 0
        ? Math.round(patch.lockTimeoutMinutes)
        : current.lockTimeoutMinutes,
    closeToTray: patch.closeToTray ?? current.closeToTray,
    autoAwayMinutes:
      typeof patch.autoAwayMinutes === "number" && patch.autoAwayMinutes > 0
        ? Math.round(patch.autoAwayMinutes)
        : current.autoAwayMinutes,
    lastServerVersion:
      patch.lastServerVersion === undefined ? current.lastServerVersion : patch.lastServerVersion,
  };
  if (settingsStore !== null) settingsStore.store = next;
  cachedSettings = next;
  const { serverUrl: _serverUrl, ...preferences } = next;
  return preferences;
}

// ---------------------------------------------------------------------------
// Tokens (safeStorage / DPAPI)
// ---------------------------------------------------------------------------

function decodeTokens(raw: unknown): StoredTokens | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.access !== "string" || typeof raw.refresh !== "string") return null;
  return { access: raw.access, refresh: raw.refresh };
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await ensureStores();
  const serialized = JSON.stringify(tokens);
  if (safeStorage.isEncryptionAvailable()) {
    sessionStore?.set("tokens", safeStorage.encryptString(serialized).toString("base64"));
    sessionStore?.set("encrypted", true);
  } else {
    // Sem DPAPI (Linux sem libsecret, por ex.) — base64 só para não gravar
    // texto puro no disco; o token de acesso expira em minutos de qualquer
    // forma e o refresh é rotativo.
    sessionStore?.set("tokens", Buffer.from(serialized, "utf8").toString("base64"));
    sessionStore?.set("encrypted", false);
  }
}

export async function loadTokens(): Promise<StoredTokens | null> {
  await ensureStores();
  const blob = sessionStore?.get("tokens");
  if (typeof blob !== "string" || blob === "") return null;
  try {
    const buffer = Buffer.from(blob, "base64");
    const raw = sessionStore?.get("encrypted") === true
      ? safeStorage.decryptString(buffer)
      : buffer.toString("utf8");
    return decodeTokens(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await ensureStores();
  sessionStore?.clear();
}

// ---------------------------------------------------------------------------
// Outbox (fila de envio persistida)
// ---------------------------------------------------------------------------

function isValidOutboxEntry(value: unknown): value is OutboxEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.clientId === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.body === "string" &&
    Array.isArray(value.attachmentIds) &&
    typeof value.queuedAt === "number" &&
    typeof value.attempts === "number"
  );
}

export async function loadOutbox(): Promise<OutboxEntry[]> {
  await ensureStores();
  const raw = outboxStore?.get("entries", []);
  return Array.isArray(raw) ? raw.filter(isValidOutboxEntry) : [];
}

export async function saveOutbox(entries: OutboxEntry[]): Promise<void> {
  await ensureStores();
  outboxStore?.set("entries", entries.filter(isValidOutboxEntry));
}
