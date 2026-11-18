/**
 * Cliente WebSocket com:
 *  - ticket de uso único antes de CADA conexão/reconexão (POST /ws/ticket,
 *    TTL 30 s) — o access token NUNCA vai na URL;
 *  - backoff 1-2-4-8-15 s e depois 15 s fixo (plano-frontend §9);
 *  - keepalive ping/pong de 25 s com watchdog de conexão morta;
 *  - estados expostos: connecting | online | reconnecting(attempt) | offline
 *    (sem rede) | sessionExpired (refresh falhou — sem novas tentativas).
 */
import { ApiError, endpoints } from "./api";
import { getServerUrl } from "./bridge";
import type { ClientWsMessage, WsEnvelope } from "../types/ws";

export type WsStatus = "connecting" | "online" | "reconnecting" | "offline" | "sessionExpired";

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const KEEPALIVE_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 75_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type EventHandler = (event: WsEnvelope) => void;
type StatusHandler = (status: WsStatus, attempt: number) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private eventHandlers: EventHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private closed = false;
  private sessionExpired = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private pongWatchdog: ReturnType<typeof setTimeout> | null = null;
  private lastServerActivity = 0;

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    if (this.closed || this.sessionExpired) return;
    this.emitStatus(this.attempt === 0 ? "connecting" : "reconnecting", this.attempt);

    let ticket: string;
    try {
      // Ticket NOVO a cada conexão — uso único, expira em 30 s.
      ticket = (await endpoints.getWsTicket()).ticket;
    } catch (error) {
      if (this.isSessionExpiredError(error)) {
        this.markSessionExpired();
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (this.closed || this.sessionExpired) return;

    let base: string;
    try {
      base = await getServerUrl();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.closed || this.sessionExpired) return;

    const wsBase = base.replace(/^http/, "ws");
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${wsBase}/ws?ticket=${encodeURIComponent(ticket)}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    this.lastServerActivity = Date.now();

    socket.onopen = () => {
      this.attempt = 0;
      this.emitStatus("online", 0);
      this.startKeepalive();
    };
    socket.onmessage = (event) => {
      this.lastServerActivity = Date.now();
      this.resetPongWatchdog();
      this.handleMessage(event.data);
    };
    socket.onclose = () => {
      this.stopKeepalive();
      this.ws = null;
      if (!this.closed && !this.sessionExpired) this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== "string") return;
    const event: WsEnvelope = {
      type: parsed.type,
      seq: typeof parsed.seq === "number" ? parsed.seq : 0,
      ts: typeof parsed.ts === "string" ? parsed.ts : "",
      payload: isRecord(parsed.payload) ? parsed.payload : {},
    };
    for (const handler of this.eventHandlers) handler(event);
  }

  private isSessionExpiredError(error: unknown): boolean {
    return (
      error instanceof ApiError &&
      (error.status === 401 || error.code === "session_expired")
    );
  }

  private markSessionExpired(): void {
    this.sessionExpired = true;
    this.stopKeepalive();
    this.clearReconnectTimer();
    this.emitStatus("sessionExpired", 0);
  }

  private emitStatus(status: WsStatus, attempt: number): void {
    for (const handler of this.statusHandlers) handler(status, attempt);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.closed || this.sessionExpired) return;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) {
      this.emitStatus("offline", this.attempt);
    } else {
      this.emitStatus("reconnecting", this.attempt + 1);
    }
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.send({ type: "ping" });
      this.armPongWatchdog();
    }, KEEPALIVE_INTERVAL_MS);
    this.armPongWatchdog();
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.resetPongWatchdog();
  }

  /** Se o servidor ficar silencioso demais, a conexão é considerada morta. */
  private armPongWatchdog(): void {
    this.resetPongWatchdog();
    this.pongWatchdog = setTimeout(() => {
      if (Date.now() - this.lastServerActivity > PONG_TIMEOUT_MS - KEEPALIVE_INTERVAL_MS) {
        this.ws?.close();
      } else {
        this.armPongWatchdog();
      }
    }, PONG_TIMEOUT_MS);
  }

  private resetPongWatchdog(): void {
    if (this.pongWatchdog !== null) {
      clearTimeout(this.pongWatchdog);
      this.pongWatchdog = null;
    }
  }

  /** Envia uma mensagem do cliente (formato achatado lido pelo servidor). */
  send(message: ClientWsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Tenta reconectar imediatamente (ex.: rede voltou). */
  retryNow(): void {
    if (this.closed || this.sessionExpired) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.clearReconnectTimer();
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.stopKeepalive();
    this.ws?.close();
    this.ws = null;
  }
}
