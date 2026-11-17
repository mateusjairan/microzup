const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("microzup", {
  getServerUrl: () => ipcRenderer.invoke("server:get"),
  setServerUrl: (url) => ipcRenderer.invoke("server:set", url),
  saveTokens: (tokens) => ipcRenderer.invoke("token:set", tokens),
  loadTokens: () => ipcRenderer.invoke("token:get"),
  clearTokens: () => ipcRenderer.invoke("token:clear"),
  saveFile: (filename, data) => ipcRenderer.invoke("file:save", { filename, data }),
  getVersion: () => ipcRenderer.invoke("app:version"),
  notify: (title, body) => ipcRenderer.invoke("notify", { title, body }),
});
