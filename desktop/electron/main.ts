/**
 * Processo main do Microzup (migrado de main.js para TypeScript).
 *
 * Segurança (plano-frontend §13): contextIsolation true, sandbox true,
 * nodeIntegration false, IPC por allowlist (electron/ipc-contract.ts) com
 * validação de payload em cada handler, links externos só http(s) via
 * shell.openExternal, nome de arquivo NUNCA vira caminho em disco
 * (dialog recebe apenas o basename).
 */
import { app, dialog, ipcMain, shell, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC } from "./ipc-contract";
import type { AppPreferences, OutboxEntry } from "./ipc-contract";
import * as persistence from "./persistence";
import {
  allAppWindows,
  createConversationWindow,
  createMainWindow,
  getMainWindow,
  markQuitting,
  showMainWindow,
} from "./windows";
import { initTray, setUnread } from "./tray";
import { showMessageNotification, showNudgeNotification, stopNotifications } from "./notifications";
import { lockNow, startIdleMonitor, stopIdleMonitor } from "./idle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Nome de arquivo nunca vira caminho: só o basename entra no diálogo. */
function safeBasename(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const base = path.basename(value);
  return base === "" || base === "." || base === ".." ? null : base;
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? getMainWindow();
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.invoke.appVersion, () => app.getVersion());

  ipcMain.handle(IPC.invoke.serverGet, () => persistence.getServerUrl());
  ipcMain.handle(IPC.invoke.serverSet, (_event, payload: unknown) => {
    if (!isRecord(payload)) return persistence.getServerUrl();
    const url = requireString(payload.url);
    if (url === null || url.length > 200) return persistence.getServerUrl();
    return persistence.setServerUrl(url);
  });

  ipcMain.handle(IPC.invoke.tokenSave, (_event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const access = requireString(payload.access);
    const refresh = requireString(payload.refresh);
    if (access === null || refresh === null) return;
    void persistence.saveTokens({ access, refresh });
  });
  ipcMain.handle(IPC.invoke.tokenLoad, () => persistence.loadTokens());
  ipcMain.handle(IPC.invoke.tokenClear, () => {
    void persistence.clearTokens();
  });

  ipcMain.handle(IPC.invoke.prefsGet, () => persistence.getPreferences());
  ipcMain.handle(IPC.invoke.prefsSet, (_event, payload: unknown) => {
    if (!isRecord(payload)) return persistence.getPreferences();
    const patch: Partial<AppPreferences> = {};
    if (payload.theme === "system" || payload.theme === "light" || payload.theme === "dark") {
      patch.theme = payload.theme;
    }
    if (typeof payload.soundsEnabled === "boolean") patch.soundsEnabled = payload.soundsEnabled;
    if (Array.isArray(payload.mutedConversations)) {
      patch.mutedConversations = payload.mutedConversations.filter(
        (id): id is string => typeof id === "string",
      );
    }
    if (typeof payload.lockTimeoutMinutes === "number" && payload.lockTimeoutMinutes > 0) {
      patch.lockTimeoutMinutes = Math.round(payload.lockTimeoutMinutes);
    }
    if (typeof payload.closeToTray === "boolean") patch.closeToTray = payload.closeToTray;
    if (typeof payload.autoAwayMinutes === "number" && payload.autoAwayMinutes > 0) {
      patch.autoAwayMinutes = Math.round(payload.autoAwayMinutes);
    }
    if (typeof payload.lastServerVersion === "string" || payload.lastServerVersion === null) {
      patch.lastServerVersion = payload.lastServerVersion;
    }
    return persistence.setPreferences(patch);
  });

  ipcMain.handle(IPC.invoke.outboxLoad, () => persistence.loadOutbox());
  ipcMain.handle(IPC.invoke.outboxSave, (_event, payload: unknown) => {
    if (!Array.isArray(payload)) return;
    void persistence.saveOutbox(
      payload.filter(
        (entry): entry is OutboxEntry =>
          isRecord(entry) &&
          typeof entry.clientId === "string" &&
          typeof entry.conversationId === "string" &&
          typeof entry.body === "string" &&
          Array.isArray(entry.attachmentIds) &&
          typeof entry.queuedAt === "number" &&
          typeof entry.attempts === "number",
      ),
    );
  });

  ipcMain.handle(IPC.invoke.fileSaveDialog, async (_event, payload: unknown) => {
    if (!isRecord(payload)) return null;
    const defaultName = safeBasename(payload.defaultName) ?? "arquivo";
    const win = focusedWindow();
    const options = {
      defaultPath: path.join(app.getPath("downloads"), defaultName),
    };
    const result =
      win !== null ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return result.canceled || result.filePath === undefined ? null : result.filePath;
  });

  ipcMain.handle(IPC.invoke.fileWrite, (_event, payload: unknown) => {
    if (!isRecord(payload)) throw new Error("invalid_file_write");
    const target = requireString(payload.path);
    const data = payload.data;
    if (target === null || !(data instanceof Uint8Array)) {
      throw new Error("invalid_file_write");
    }
    // Caminhos absolutos vindos do próprio diálogo de salvamento.
    if (!path.isAbsolute(target)) {
      throw new Error("invalid_path");
    }
    fs.writeFileSync(target, Buffer.from(data));
  });

  ipcMain.handle(IPC.invoke.fileOpen, async (_event, payload: unknown) => {
    if (!isRecord(payload)) return "invalid_path";
    const target = requireString(payload.path);
    if (target === null || !path.isAbsolute(target)) return "invalid_path";
    const error = await shell.openPath(target);
    return error === "" ? null : error;
  });

  ipcMain.handle(IPC.invoke.shellOpenExternal, (_event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const url = requireString(payload.url);
    if (url === null || !/^https?:\/\//i.test(url)) return;
    void shell.openExternal(url);
  });

  ipcMain.handle(IPC.invoke.winMinimize, () => {
    focusedWindow()?.minimize();
  });
  ipcMain.handle(IPC.invoke.winToggleMaximize, () => {
    const win = focusedWindow();
    if (win === null) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle(IPC.invoke.winClose, () => {
    focusedWindow()?.close(); // respeita close-to-tray via windows.ts
  });
  ipcMain.handle(IPC.invoke.winIsMaximized, () => focusedWindow()?.isMaximized() ?? false);

  ipcMain.handle(IPC.invoke.winOpenConversation, (_event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const conversationId = requireString(payload.conversationId);
    if (conversationId === null) return;
    void createConversationWindow(conversationId);
  });

  ipcMain.handle(IPC.invoke.traySetUnread, (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.count !== "number") return;
    setUnread(Math.max(0, Math.floor(payload.count)));
  });

  ipcMain.handle(IPC.invoke.notifyShow, (_event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const title = requireString(payload.title);
    const body = requireString(payload.body);
    const conversationId = requireString(payload.conversationId);
    if (title === null || body === null || conversationId === null) return;
    showMessageNotification({ title, body, conversationId });
  });

  ipcMain.handle(IPC.invoke.notifyNudge, (_event, payload: unknown) => {
    if (!isRecord(payload)) return;
    const title = requireString(payload.title);
    const body = requireString(payload.body);
    const conversationId = requireString(payload.conversationId);
    if (title === null || body === null || conversationId === null) return;
    showNudgeNotification({ title, body, conversationId });
  });

  ipcMain.handle(IPC.invoke.sessionLock, () => {
    lockNow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    void (async () => {
      await persistence.initPersistence();
      registerIpcHandlers();
      await createMainWindow();
      initTray();
      startIdleMonitor();
      app.on("activate", () => {
        void createMainWindow();
      });
    })();
  });

  app.on("before-quit", () => {
    markQuitting();
    stopIdleMonitor();
    stopNotifications();
    for (const win of allAppWindows()) {
      if (!win.isDestroyed()) win.setOverlayIcon(null, "");
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
