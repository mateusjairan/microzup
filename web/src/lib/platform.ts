/**
 * Plataforma web — tudo que no produto anterior era IPC do Electron.
 *
 * O que NÃO mora aqui: segredos. O refresh token é cookie HttpOnly (invisível
 * ao JavaScript) e o access token vive só em memória, em `lib/api.ts`. Nada de
 * token em localStorage.
 *
 * Persistência local: apenas preferências e a fila de envio (outbox), ambas
 * sem credencial. "Bandeja"/"janela" viram título + badge, notificações nativas
 * viram a Notification API e a inatividade é observada no próprio documento.
 */

export interface AppPreferences {
  theme: "system" | "light" | "dark";
  soundsEnabled: boolean;
  mutedConversations: string[];
  /** Bloqueio de sessão por inatividade, em minutos (0 = desligado). */
  lockTimeoutMinutes: number;
  /** Auto-ausente após N minutos sem interação (0 = desligado). */
  autoAwayMinutes: number;
  /** Última versão do servidor vista — usada para detectar "nova versão". */
  lastServerVersion: string | null;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  soundsEnabled: false,
  mutedConversations: [],
  lockTimeoutMinutes: 15,
  autoAwayMinutes: 10,
  lastServerVersion: null,
};

/** Entrada da fila de envio persistida no navegador. */
export interface OutboxEntry {
  /** client_id do envio idempotente — NUNCA muda entre retries. */
  clientId: string;
  conversationId: string;
  body: string;
  attachmentIds: string[];
  /** epoch ms da primeira tentativa. */
  queuedAt: number;
  attempts: number;
  /** Chave i18n do último erro, se houver. */
  lastErrorKey: string | null;
  /** true quando o servidor rejeitou de forma definitiva (4xx de validação). */
  permanent: boolean;
}

export interface MessageNotificationRequest {
  title: string;
  body: string;
  conversationId: string;
}

export type NudgeNotificationRequest = MessageNotificationRequest;

const PREFS_KEY = "microzup.prefs";
const OUTBOX_KEY = "microzup.outbox";
const DEFAULT_TITLE = "Microzup";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Preferências
// ---------------------------------------------------------------------------

export function getPreferences(): AppPreferences {
  const parsed = readJson<Partial<AppPreferences>>(PREFS_KEY);
  if (parsed === null || !isRecord(parsed)) return { ...DEFAULT_PREFERENCES };
  return { ...DEFAULT_PREFERENCES, ...parsed };
}

export function setPreferences(patch: Partial<AppPreferences>): AppPreferences {
  const next = { ...getPreferences(), ...patch };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------
// Fila de envio (outbox)
// ---------------------------------------------------------------------------

export function loadOutbox(): OutboxEntry[] {
  const parsed = readJson<unknown>(OUTBOX_KEY);
  return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
}

export function saveOutbox(entries: OutboxEntry[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// Arquivos: download direto pelo navegador (sem diálogo nativo)
// ---------------------------------------------------------------------------

/** Dispara o download de um Blob com o nome original do anexo. */
export function saveBlob(filename: string, data: Uint8Array): void {
  const bytes = new Uint8Array(data);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // O clique inicia o download de forma síncrona; revogar em seguida evita
    // vazamento do object URL sem cortar a transferência.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * "Abrir conversa em outra janela" (antes: BrowserWindow dedicada do Electron).
 * Abre uma aba com `?conversation=<id>` — o boot lê esse parâmetro.
 */
export function openConversationWindow(conversationId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("conversation", conversationId);
  window.open(url.toString(), "_blank", "noopener");
}

// ---------------------------------------------------------------------------
// Notificações e badge
// ---------------------------------------------------------------------------

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type ConversationOpenedListener = (conversationId: string) => void;
const conversationOpenedListeners = new Set<ConversationOpenedListener>();

export function onConversationOpened(listener: ConversationOpenedListener): () => void {
  conversationOpenedListeners.add(listener);
  return () => conversationOpenedListeners.delete(listener);
}

function emitConversationOpened(conversationId: string): void {
  for (const listener of conversationOpenedListeners) listener(conversationId);
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

function notify(payload: MessageNotificationRequest, tagPrefix: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const notification = new Notification(payload.title, {
    body: payload.body,
    tag: `${tagPrefix}:${payload.conversationId}`,
    icon: "/icon-256.png",
  });
  notification.onclick = () => {
    window.focus();
    emitConversationOpened(payload.conversationId);
    notification.close();
  };
}

export function showNotification(payload: MessageNotificationRequest): void {
  notify(payload, "message");
}

export function showNudge(payload: NudgeNotificationRequest): void {
  notify(payload, "nudge");
  if (typeof navigator.vibrate === "function") navigator.vibrate([120, 60, 120]);
}

/** Badge de não lidas: título da aba (sempre) + app badge (quando suportado). */
export function setUnreadCount(count: number): void {
  document.title = count > 0 ? `(${count}) ${DEFAULT_TITLE}` : DEFAULT_TITLE;
  const nav = navigator as BadgeNavigator;
  if (count > 0) {
    void nav.setAppBadge?.(count).catch(() => undefined);
  } else {
    void nav.clearAppBadge?.().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Inatividade (auto-ausente + bloqueio de sessão)
// ---------------------------------------------------------------------------

export interface ActivityWatcherOptions {
  onAway: () => void;
  onActive: () => void;
  onLock: () => void;
}

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const ACTIVITY_CHECK_MS = 15_000;

/**
 * Observa atividade no documento. `onLock` dispara uma vez por período ocioso
 * e rearma quando o usuário volta a interagir (inclusive digitando a senha no
 * overlay de reautenticação).
 */
export function startActivityWatcher(options: ActivityWatcherOptions): () => void {
  let lastActivity = Date.now();
  let away = false;
  let lockArmed = true;

  const touch = (): void => {
    lastActivity = Date.now();
    lockArmed = true;
    if (away) {
      away = false;
      options.onActive();
    }
  };

  const onVisibility = (): void => {
    if (document.visibilityState === "visible") touch();
  };

  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, touch, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisibility);

  const timer = setInterval(() => {
    const idle = Date.now() - lastActivity;
    const { autoAwayMinutes, lockTimeoutMinutes } = getPreferences();
    if (autoAwayMinutes > 0 && !away && idle >= autoAwayMinutes * 60_000) {
      away = true;
      options.onAway();
    }
    if (lockTimeoutMinutes > 0 && lockArmed && idle >= lockTimeoutMinutes * 60_000) {
      lockArmed = false;
      options.onLock();
    }
  }, ACTIVITY_CHECK_MS);

  return () => {
    clearInterval(timer);
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, touch);
    }
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
