const { app, BrowserWindow, ipcMain, dialog, safeStorage, Notification } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const configPath = () => path.join(app.getPath("userData"), "config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const config = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return config;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0F1319",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    ipcMain.handle("server:get", () => readConfig().serverUrl || "http://localhost:8666");
    ipcMain.handle("server:set", (_e, url) => writeConfig({ serverUrl: url }).serverUrl);

    ipcMain.handle("token:set", (_e, tokens) => {
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(JSON.stringify(tokens)).toString("base64")
        : Buffer.from(JSON.stringify(tokens), "utf8").toString("base64");
      writeConfig({ tokens: encrypted, encrypted: safeStorage.isEncryptionAvailable() });
      return true;
    });
    ipcMain.handle("token:get", () => {
      const cfg = readConfig();
      if (!cfg.tokens) return null;
      const buffer = Buffer.from(cfg.tokens, "base64");
      const raw = cfg.encrypted ? safeStorage.decryptString(buffer) : buffer.toString("utf8");
      return JSON.parse(raw);
    });
    ipcMain.handle("token:clear", () => writeConfig({ tokens: null, encrypted: false }));

    ipcMain.handle("file:save", async (_e, payload) => {
      const { filename, data } = payload;
      const result = await dialog.showSaveDialog(mainWindow, { defaultPath: filename });
      if (result.canceled || !result.filePath) return false;
      fs.writeFileSync(result.filePath, Buffer.from(data));
      return true;
    });

    ipcMain.handle("notify", (_e, payload) => {
      new Notification({ title: payload.title, body: payload.body }).show();
    });

    ipcMain.handle("app:version", () => app.getVersion());

    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
