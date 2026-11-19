/**
 * Contrato de IPC — única fonte de verdade dos canais e payloads compartilhados
 * entre o processo main (handlers), o preload (allowlist) e o renderer (bridge).
 *
 * Este arquivo é puro TypeScript sem dependência de Node nem de Electron:
 * o renderer importa os tipos e as constantes de canal daqui (bundle leve),
 * e o processo main usa os mesmos nomes para registrar os handlers.
 */

export const IPC = {
  /** Canais invoke (renderer → main) — allowlist total do preload. */
  invoke: {
    appVersion: "app:version",
    serverGet: "server:get",
    serverSet: "server:set",
    tokenSave: "token:save",
    tokenLoad: "token:load",
    tokenClear: "token:clear",
    prefsGet: "prefs:get",
    prefsSet: "prefs:set",
    outboxLoad: "outbox:load",
    outboxSave: "outbox:save",
    fileSaveDialog: "file:save-dialog",
    fileWrite: "file:write",
    fileOpen: "file:open",
    shellOpenExternal: "shell:open-external",
    winMinimize: "win:minimize",
    winToggleMaximize: "win:toggle-maximize",
    winClose: "win:close",
    winIsMaximized: "win:is-maximized",
    winOpenConversation: "win:open-conversation",
    traySetUnread: "tray:set-unread",
    notifyShow: "notify:show",
    notifyNudge: "notify:nudge",
    sessionLock: "session:lock",
  },
  /** Canais de evento (main → renderer). */
  events: {
    sessionLocked: "session:locked",
    idleAway: "idle:away",
    idleActive: "idle:active",
    openConversation: "notify:conversation-opened",
    winMaximized: "win:maximized",
    presenceSetRequested: "presence:set-requested",
  },
} as const;

/** Sessão persistida: o refresh token é guardado em safeStorage (DPAPI). */
export interface StoredTokens {
  access: string;
  refresh: string;
}

/** Preferências do aplicativo (electron-store, arquivo "settings"). */
export interface AppPreferences {
  /** Tema visual: segue o SO por padrão. */
  theme: "system" | "light" | "dark";
  /** Sons de notificação — desligados por padrão (plano-frontend §3). */
  soundsEnabled: boolean;
  /** Conversas silenciadas (sem toast; badge continua). */
  mutedConversations: string[];
  /** Bloqueio de sessão por inatividade, em minutos (padrão 15). */
  lockTimeoutMinutes: number;
  /** Fechar (✕) minimiza para a bandeja em vez de encerrar. */
  closeToTray: boolean;
  /** Auto-ausente após N minutos de inatividade do SO (padrão 10). */
  autoAwayMinutes: number;
  /** Última versão do servidor vista — usada para detectar "nova versão". */
  lastServerVersion: string | null;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "system",
  soundsEnabled: false,
  mutedConversations: [],
  lockTimeoutMinutes: 15,
  closeToTray: true,
  autoAwayMinutes: 10,
  lastServerVersion: null,
};

/**
 * Endereço sugerido do servidor na primeira execução (plano-frontend §4: a tela
 * de servidor aparece pré-preenchida, sem descoberta automática no MVP).
 *
 * O piloto roda em LAN: o servidor fica numa máquina e o cliente nas estações,
 * então `localhost` apontaria para a própria estação e a primeira execução
 * falharia em toda máquina que não fosse a do servidor. Para outro endereço,
 * defina MICROZUP_SERVER_URL no ambiente do build — ou digite no campo
 * **Servidor** do login, que tem precedência e fica persistido.
 */
const SERVER_URL_FROM_ENV = process.env.MICROZUP_SERVER_URL?.trim() ?? "";

export const DEFAULT_SERVER_URL =
  SERVER_URL_FROM_ENV.length > 0 ? SERVER_URL_FROM_ENV : "http://192.168.10.17:8666";

/** Conteúdo integral do arquivo "settings" (preferências + servidor). */
export interface PersistedSettings extends AppPreferences {
  serverUrl: string;
  /**
   * Marca a migração única do padrão antigo (`http://localhost:8666`) para o
   * endereço de LAN. Depois de marcada, um endereço digitado pelo usuário é
   * respeitado para sempre — a migração nunca reescreve de novo.
   */
  serverUrlMigratedToLan?: boolean;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  ...DEFAULT_PREFERENCES,
  serverUrl: DEFAULT_SERVER_URL,
};

/** Entrada da fila de envio persistida em disco (electron-store, arquivo "outbox"). */
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

export interface SaveDialogRequest {
  defaultName: string;
}

export interface FileWriteRequest {
  path: string;
  data: Uint8Array;
}

export interface FilePathRequest {
  path: string;
}

export interface OpenExternalRequest {
  url: string;
}

export interface ConversationRequest {
  conversationId: string;
}

export interface SetUnreadRequest {
  count: number;
}

export interface ServerSetRequest {
  url: string;
}

/** Toast nativo de mensagem — strings já traduzidas pelo renderer (i18n). */
export interface MessageNotificationRequest {
  title: string;
  body: string;
  conversationId: string;
}

/** Toast de "chamar atenção" + flash na barra de tarefas. */
export interface NudgeNotificationRequest {
  title: string;
  body: string;
  conversationId: string;
}

export interface IdleAwayEvent {
  idleMinutes: number;
}

export interface ConversationOpenedEvent {
  conversationId: string;
}

export interface WinMaximizedEvent {
  maximized: boolean;
}

export type PresenceValue = "available" | "busy" | "away" | "dnd" | "invisible";

export interface PresenceSetRequestedEvent {
  status: PresenceValue;
}
