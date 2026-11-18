import type { PresenceStatus } from "../ui/presence";

/**
 * Tipos de props de domínio — MIRILHAM o modelo do servidor, mas vivem aqui
 * para que os componentes sejam 100% dirigidos por props (etapa 2 liga ao
 * store sem tocar nestes arquivos).
 */

export type { PresenceStatus };

/** Ciclo de vida otimista (§8.1): sending → sent | failed. */
export type MessageDelivery = "sending" | "sent" | "failed";

export interface ChatAttachment {
  id: string;
  kind: "image" | "file";
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  /** URL completa para download/lightbox. */
  url?: string;
  /** Miniatura (480 px) para imagem (§8.6). */
  thumbnailUrl?: string;
  state: "ready" | "uploading" | "error" | "unavailable";
  /** 0–100 durante upload/download. */
  progress?: number;
}

export interface ChatMessage {
  id: string;
  /** Ordem canônica do servidor (§ regras de dados: nunca `created_at`). Otimistas ainda não têm. */
  seq?: number;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  body: string;
  delivery: MessageDelivery;
  editedAt?: string | null;
  deletedAt?: string | null;
  attachments?: ChatAttachment[];
}

export interface TypingPerson {
  id: string;
  name: string;
}

/** Item da fila de uploads pendentes no composer (AttachmentTray). */
export interface PendingAttachment {
  id: string;
  filename: string;
  sizeBytes: number;
  /**
   * "queued" aguarda o envio · "uploading" com progresso · "error" pede
   * retry · "ready" subiu e acompanha a próxima mensagem.
   */
  state: "queued" | "uploading" | "error" | "ready";
  progress?: number;
}
