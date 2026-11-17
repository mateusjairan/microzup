import { getServerUrl, loadTokens, saveTokens } from "./bridge";
import type { Tokens } from "../types";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let initialized = false;

export async function initAuth(): Promise<boolean> {
  if (initialized) return accessToken !== null;
  initialized = true;
  const tokens = await loadTokens();
  if (tokens) {
    accessToken = tokens.access;
    refreshToken = tokens.refresh;
  }
  return accessToken !== null;
}

export async function setTokens(tokens: Tokens): Promise<void> {
  accessToken = tokens.access;
  refreshToken = tokens.refresh;
  await saveTokens(tokens);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function clear(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  const { clearTokens } = await import("./bridge");
  await clearTokens();
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = await getServerUrl();
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${base}${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? "request_failed",
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};

export async function downloadFile(path: string, filename: string): Promise<void> {
  const base = await getServerUrl();
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, "download", "download_failed");
  }
  const buffer = await response.arrayBuffer();
  const { saveFile } = await import("./bridge");
  await saveFile(filename, new Uint8Array(buffer));
}
