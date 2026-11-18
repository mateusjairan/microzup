/**
 * Janelas: principal (frameless com barra de título custom) e janelas
 * destacadas de conversa (?conversation=<id>). Fechar minimiza para a
 * bandeja quando a preferência closeToTray está ativa.
 */
import { BrowserWindow } from "electron";
import path from "node:path";
import { IPC } from "./ipc-contract";
import { getCachedSettings } from "./persistence";

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
const conversationWindows = new Map<string, BrowserWindow>();
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function allAppWindows(): BrowserWindow[] {
  return [...(mainWindow !== null ? [mainWindow] : []), ...conversationWindows.values()];
}

function preloadPath(): string {
  return path.join(__dirname, "preload.js");
}

async function loadApp(win: BrowserWindow, conversationId?: string): Promise<void> {
  if (devServerUrl !== undefined) {
    const url =
      conversationId === undefined
        ? devServerUrl
        : `${devServerUrl}?conversation=${encodeURIComponent(conversationId)}`;
    await win.loadURL(url);
    return;
  }
  const filePath = path.join(__dirname, "..", "..", "dist", "index.html");
  if (conversationId === undefined) {
    await win.loadFile(filePath);
  } else {
    await win.loadFile(filePath, { query: { conversation: conversationId } });
  }
}

const BASE_WEB_PREFERENCES = {
  preload: preloadPath(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const;

export async function createMainWindow(): Promise<BrowserWindow> {
  if (mainWindow !== null && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: "#0F1319",
    webPreferences: { ...BASE_WEB_PREFERENCES },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("close", (event) => {
    if (!quitting && getCachedSettings().closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send(IPC.events.winMaximized, { maximized: true });
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send(IPC.events.winMaximized, { maximized: false });
  });
  // O flash de "chamar atenção" para quando a janela ganha foco.
  mainWindow.on("focus", () => {
    mainWindow?.flashFrame(false);
  });

  await loadApp(mainWindow);
  return mainWindow;
}

export async function createConversationWindow(conversationId: string): Promise<void> {
  const existing = conversationWindows.get(conversationId);
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 400,
    minHeight: 480,
    show: false,
    frame: false,
    backgroundColor: "#0F1319",
    parent: mainWindow ?? undefined,
    webPreferences: { ...BASE_WEB_PREFERENCES },
  });
  conversationWindows.set(conversationId, win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    conversationWindows.delete(conversationId);
  });
  win.on("maximize", () => {
    win.webContents.send(IPC.events.winMaximized, { maximized: true });
  });
  win.on("unmaximize", () => {
    win.webContents.send(IPC.events.winMaximized, { maximized: false });
  });
  win.on("focus", () => {
    win.flashFrame(false);
  });
  await loadApp(win, conversationId);
}

export function showMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export async function reopenMainWindow(): Promise<void> {
  await createMainWindow();
  showMainWindow();
}

export function focusActiveWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused !== null) {
    focused.show();
    focused.focus();
    return focused;
  }
  showMainWindow();
  return mainWindow;
}
