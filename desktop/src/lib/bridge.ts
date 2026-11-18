import type { Tokens } from "../types";

interface MicrozupBridge {
  getServerUrl(): Promise<string>;
  setServerUrl(url: string): Promise<string>;
  saveTokens(tokens: Tokens): Promise<boolean>;
  loadTokens(): Promise<Tokens | null>;
  clearTokens(): Promise<void>;
  saveFile(filename: string, data: Uint8Array): Promise<boolean>;
  getVersion(): Promise<string>;
  notify(title: string, body: string): void;
}

declare global {
  interface Window {
    microzup?: MicrozupBridge;
  }
}

const SERVER_KEY = "microzup.server";

export async function getServerUrl(): Promise<string> {
  if (window.microzup) return window.microzup.getServerUrl();
  return localStorage.getItem(SERVER_KEY) ?? "http://localhost:8666";
}

export async function setServerUrl(url: string): Promise<void> {
  if (window.microzup) {
    await window.microzup.setServerUrl(url);
  } else {
    localStorage.setItem(SERVER_KEY, url);
  }
}

export async function saveTokens(tokens: Tokens): Promise<void> {
  if (window.microzup) {
    await window.microzup.saveTokens(tokens);
  } else {
    localStorage.setItem("microzup.tokens", JSON.stringify(tokens));
  }
}

export async function loadTokens(): Promise<Tokens | null> {
  if (window.microzup) return window.microzup.loadTokens();
  const raw = localStorage.getItem("microzup.tokens");
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

export async function clearTokens(): Promise<void> {
  if (window.microzup) {
    await window.microzup.clearTokens();
  } else {
    localStorage.removeItem("microzup.tokens");
  }
}

export async function saveFile(filename: string, data: Uint8Array): Promise<boolean> {
  if (window.microzup) return window.microzup.saveFile(filename, data);
  const blob = new Blob([data as unknown as BlobPart]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

export function notify(title: string, body: string): void {
  if (window.microzup) window.microzup.notify(title, body);
}
