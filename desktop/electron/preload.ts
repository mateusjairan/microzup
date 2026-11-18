/**
 * Preload — allowlist estrita de IPC (plano-frontend §13).
 *
 * Expõe APENAS as funções abaixo em `window.microzup`; nenhum ipcRenderer
 * cruza a fronteira. Eventos do main são assináveis um-a-um, com cleanup.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipc-contract";
import type {
  AppPreferences,
  MessageNotificationRequest,
  NudgeNotificationRequest,
  OutboxEntry,
  StoredTokens,
} from "./ipc-contract";

type Unsubscribe = () => void;

function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): Unsubscribe {
  const wrapped = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("microzup", {
  // Servidor e sessão
  getServerUrl: (): Promise<string> => ipcRenderer.invoke(IPC.invoke.serverGet),
  setServerUrl: (url: string): Promise<string> =>
    ipcRenderer.invoke(IPC.invoke.serverSet, { url }),
  saveTokens: (tokens: StoredTokens): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.tokenSave, tokens),
  loadTokens: (): Promise<StoredTokens | null> => ipcRenderer.invoke(IPC.invoke.tokenLoad),
  clearTokens: (): Promise<void> => ipcRenderer.invoke(IPC.invoke.tokenClear),

  // Preferências e fila de envio
  getPreferences: (): Promise<AppPreferences> => ipcRenderer.invoke(IPC.invoke.prefsGet),
  setPreferences: (patch: Partial<AppPreferences>): Promise<AppPreferences> =>
    ipcRenderer.invoke(IPC.invoke.prefsSet, patch),
  loadOutbox: (): Promise<OutboxEntry[]> => ipcRenderer.invoke(IPC.invoke.outboxLoad),
  saveOutbox: (entries: OutboxEntry[]): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.outboxSave, entries),

  // Arquivos
  saveFileDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.invoke.fileSaveDialog, { defaultName }),
  writeFile: (path: string, data: Uint8Array): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.fileWrite, { path, data }),
  openFile: (path: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.invoke.fileOpen, { path }),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.shellOpenExternal, { url }),

  // Janela e bandeja
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.invoke.winMinimize),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.invoke.winToggleMaximize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.invoke.winClose),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.invoke.winIsMaximized),
  openConversationWindow: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.winOpenConversation, { conversationId }),
  setUnreadCount: (count: number): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.traySetUnread, { count }),

  // Notificações e bloqueio
  showNotification: (payload: MessageNotificationRequest): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.notifyShow, payload),
  showNudge: (payload: NudgeNotificationRequest): Promise<void> =>
    ipcRenderer.invoke(IPC.invoke.notifyNudge, payload),
  lockSession: (): Promise<void> => ipcRenderer.invoke(IPC.invoke.sessionLock),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.invoke.appVersion),

  // Eventos main → renderer
  onSessionLocked: (listener: () => void): Unsubscribe =>
    subscribe(IPC.events.sessionLocked, listener),
  onIdleAway: (listener: (idleMinutes: number) => void): Unsubscribe =>
    subscribe<number>(IPC.events.idleAway, listener),
  onIdleActive: (listener: () => void): Unsubscribe =>
    subscribe(IPC.events.idleActive, listener),
  onOpenConversation: (listener: (conversationId: string) => void): Unsubscribe =>
    subscribe<string>(IPC.events.openConversation, listener),
  onWindowMaximized: (listener: (maximized: boolean) => void): Unsubscribe =>
    subscribe<boolean>(IPC.events.winMaximized, listener),
  onPresenceSetRequested: (
    listener: (status: "available" | "busy" | "away" | "dnd" | "invisible") => void,
  ): Unsubscribe => subscribe(IPC.events.presenceSetRequested, listener),
});
