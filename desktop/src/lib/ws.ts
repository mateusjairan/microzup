import { api } from "./api";
import { getServerUrl } from "./bridge";

export interface WsEvent {
  type: string;
  seq: number;
  ts: string;
  payload: Record<string, unknown>;
}

type Handler = (event: WsEvent) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private closed = false;
  private retries = 0;
  private reconnectTimer: number | null = null;

  onEvent(handler: Handler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    this.closed = false;
    try {
      const { ticket } = await api.post<{ ticket: string }>("/ws/ticket");
      const base = await getServerUrl();
      const wsBase = base.replace(/^http/, "ws");
      this.ws = new WebSocket(`${wsBase}/ws?ticket=${ticket}`);

      this.ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data as string) as WsEvent;
        this.handlers.forEach((handler) => handler(parsed));
      };
      this.ws.onclose = () => {
        if (!this.closed) this.scheduleReconnect();
      };
      this.ws.onerror = () => this.ws?.close();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(15000, 1000 * 2 ** this.retries);
    this.retries += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
