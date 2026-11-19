/**
 * Ponte renderer ↔ processo main (Electron) com fallbacks para navegador.
 *
 * A superfície aqui espelha 1:1 o allowlist do preload (electron/preload.ts);
 * os nomes de canal vêm de electron/ipc-contract.ts. Fora do Electron
 * (dev no navegador) usa localStorage + APIs web — apenas para desenvolvimento.
 */
import { IPC } from "../../electron/ipc-contract";
import type {
  AppPreferences,
  MessageNotificationRequest,
  NudgeNotificationRequest,
  OutboxEntry,
  StoredTokens,
} from "../../electron/ipc-contract";
import type { PresenceValue } from "../types/client";

type Unsubscribe = () => void;

interface MicrozupBridge {
  getServerUrl(): Promise<string>;
  setServerUrl(url: string): Promise<string>;
  saveTokens(tokens: StoredTokens): Promise<void>;
  loadTokens(): Promise<StoredTokens | null>;
  clearTokens(): Promise<void>;
  getPreferences(): Promise<AppPreferences>;
  setPreferences(patch: Partial<AppPreferences>): Promise<AppPreferences>;
  loadOutbox(): Promise<OutboxEntry[]>;
  saveOutbox(entries: OutboxEntry[]): Promise<void>;
  saveFileDialog(defaultName: string): Promise<string | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  openFile(path: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximize(): Promise<void>;
  closeWindow(): Promise<void>;
  isMaximized(): Promise<boolean>;
  openConversationWindow(conversationId: string): Promise<void>;
  setUnreadCount(count: number): Promise<void>;
  showNotification(payload: MessageNotificationRequest): Promise<void>;
  showNudge(payload: NudgeNotificationRequest): Promise<void>;
  lockSession(): Promise<void>;
  getAppVersion(): Promise<string>;
  onSessionLocked(listener: () => void): Unsubscribe;
  onIdleAway(listener: (idleMinutes: number) => void): Unsubscribe;
  onIdleActive(listener: () => void): Unsubscribe;
  onOpenConversation(listener: (conversationId: string) => void): Unsubscribe;
  onWindowMaximized(listener: (maximized: boolean) => void): Unsubscribe;
  onPresenceSetRequested(listener: (status: PresenceValue) => void): Unsubscribe;
}

declare global {
  interface Window {
    microzup?: MicrozupBridge;
  }
}

const SERVER_KEY = "microzup.server";
const TOKENS_KEY = "microzup.tokens";
const OUTBOX_KEY = "microzup.outbox";
const PREFS_KEY = "microzup.prefs";

/**
 * Endereço do servidor quando NÃO há preload do Electron (dev web puro e
 * fallback de navegador). No app empacotado quem manda é o main
 * (`electron/ipc-contract.ts`), com o mesmo padrão de LAN.
 */
function defaultServerUrl(): string {
  const fromEnv: unknown = import.meta.env.VITE_SERVER_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return "http://192.168.10.17:8666";
}

const FALLBACK_SERVER = defaultServerUrl();

// Proteção anti-regressão: DENTRO do Electron o preload DEVE existir. O
// fallback de navegador é só para dev web — no app empacotado ele escondia
// um preload quebrado (sandbox não carrega require() de arquivo local) atrás
// de um app "quase funcionando" (tokens em localStorage em vez de
// safeStorage, sem outbox em disco, sem IPC). Gritar alto é o diagnóstico.
if (
  typeof navigator !== "undefined" &&
  /electron/i.test(navigator.userAgent) &&
  typeof window !== "undefined" &&
  window.microzup === undefined
) {
  // eslint-disable-next-line no-console -- diagnóstico deliberado
  console.error(
    "[microzup] ERRO CRÍTICO: rodando dentro do Electron sem window.microzup — o preload não carregou. " +
      "O bridge caiu no fallback de NAVEGADOR (refresh token em localStorage, sem safeStorage/DPAPI, " +
      "sem outbox persistida, sem bandeja/notificações/lock via IPC). " +
      "Causa provável: preload não autocontido (preload sandboxed não faz require() de arquivo local). " +
      "Reconstrua com: npm run build:preload (esbuild --bundle).",
  );
}

function fallbackPreferences(): AppPreferences {
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) {
    return {
      theme: "system",
      soundsEnabled: false,
      mutedConversations: [],
      lockTimeoutMinutes: 15,
      closeToTray: true,
      autoAwayMinutes: 10,
      lastServerVersion: null,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    return { ...fallbackDefaults(), ...parsed };
  } catch {
    return fallbackDefaults();
  }
}

function fallbackDefaults(): AppPreferences {
  return {
    theme: "system",
    soundsEnabled: false,
    mutedConversations: [],
    lockTimeoutMinutes: 15,
    closeToTray: true,
    autoAwayMinutes: 10,
    lastServerVersion: null,
  };
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.microzup !== undefined;
}

export async function getServerUrl(): Promise<string> {
  if (window.microzup) return window.microzup.getServerUrl();
  return localStorage.getItem(SERVER_KEY) ?? FALLBACK_SERVER;
}

export async function setServerUrl(url: string): Promise<void> {
  if (window.microzup) {
    await window.microzup.setServerUrl(url);
  } else {
    localStorage.setItem(SERVER_KEY, url);
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  if (window.microzup) {
    await window.microzup.saveTokens(tokens);
  } else {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  }
}

export async function loadTokens(): Promise<StoredTokens | null> {
  if (window.microzup) return window.microzup.loadTokens();
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (typeof parsed.access !== "string" || typeof parsed.refresh !== "string") return null;
    return { access: parsed.access, refresh: parsed.refresh };
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  if (window.microzup) {
    await window.microzup.clearTokens();
  } else {
    localStorage.removeItem(TOKENS_KEY);
  }
  // A camada de sessão (lib/api) usa isto para marcar modo "só nesta execução":
  // quem apaga os tokens do disco logo após o login não quer rotações gravadas.
  for (const listener of tokensClearedListeners) listener();
}

type TokensClearedListener = () => void;
const tokensClearedListeners = new Set<TokensClearedListener>();

/** Registrado por lib/api para detectar "sessão só nesta execução". */
export function onTokensCleared(listener: TokensClearedListener): Unsubscribe {
  tokensClearedListeners.add(listener);
  return () => tokensClearedListeners.delete(listener);
}

export async function getPreferences(): Promise<AppPreferences> {
  if (window.microzup) return window.microzup.getPreferences();
  return fallbackPreferences();
}

export async function setPreferences(patch: Partial<AppPreferences>): Promise<AppPreferences> {
  if (window.microzup) return window.microzup.setPreferences(patch);
  const next = { ...fallbackPreferences(), ...patch };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export async function loadOutbox(): Promise<OutboxEntry[]> {
  if (window.microzup) return window.microzup.loadOutbox();
  const raw = localStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(entries: OutboxEntry[]): Promise<void> {
  if (window.microzup) {
    await window.microzup.saveOutbox(entries);
  } else {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  }
}

export async function saveFileDialog(defaultName: string): Promise<string | null> {
  if (window.microzup) return window.microzup.saveFileDialog(defaultName);
  return null;
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  if (window.microzup) {
    await window.microzup.writeFile(path, data);
    return;
  }
  throw new Error("writeFile_unavailable_in_browser");
}

export async function openFile(path: string): Promise<string | null> {
  if (window.microzup) return window.microzup.openFile(path);
  return null;
}

export async function openExternal(url: string): Promise<void> {
  if (window.microzup) {
    await window.microzup.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export async function minimizeWindow(): Promise<void> {
  await window.microzup?.minimizeWindow();
}

export async function toggleMaximize(): Promise<void> {
  await window.microzup?.toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  await window.microzup?.closeWindow();
}

export async function isMaximized(): Promise<boolean> {
  return window.microzup ? window.microzup.isMaximized() : false;
}

export async function openConversationWindow(conversationId: string): Promise<void> {
  await window.microzup?.openConversationWindow(conversationId);
}

export async function setUnreadCount(count: number): Promise<void> {
  await window.microzup?.setUnreadCount(count);
}

export async function showNotification(
  payload: MessageNotificationRequest,
): Promise<void> {
  if (window.microzup) {
    await window.microzup.showNotification(payload);
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(payload.title, { body: payload.body });
  }
}

export async function showNudge(payload: NudgeNotificationRequest): Promise<void> {
  if (window.microzup) {
    await window.microzup.showNudge(payload);
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(payload.title, { body: payload.body });
  }
}

export async function lockSession(): Promise<void> {
  await window.microzup?.lockSession();
}

export async function getAppVersion(): Promise<string> {
  return window.microzup ? window.microzup.getAppVersion() : "0.0.0-web";
}

export function onSessionLocked(listener: () => void): Unsubscribe {
  return window.microzup?.onSessionLocked(listener) ?? (() => {});
}

export function onIdleAway(listener: (idleMinutes: number) => void): Unsubscribe {
  return window.microzup?.onIdleAway(listener) ?? (() => {});
}

export function onIdleActive(listener: () => void): Unsubscribe {
  return window.microzup?.onIdleActive(listener) ?? (() => {});
}

export function onOpenConversation(listener: (conversationId: string) => void): Unsubscribe {
  return window.microzup?.onOpenConversation(listener) ?? (() => {});
}

export function onWindowMaximized(listener: (maximized: boolean) => void): Unsubscribe {
  return window.microzup?.onWindowMaximized(listener) ?? (() => {});
}

export function onPresenceSetRequested(listener: (status: PresenceValue) => void): Unsubscribe {
  return window.microzup?.onPresenceSetRequested(listener) ?? (() => {});
}

/** Canais expostos — usado apenas para documentação/depuração do allowlist. */
export const IPC_CHANNELS = IPC;
