import type { ChatMessage } from "../chat/types";

/**
 * Fixtures de Storybook — 100% offline: imagens são SVG data-URLs geradas
 * localmente (nada é baixado em runtime, §14).
 */

const MINUTE = 60_000;

export function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

export function isoDaysAgo(days: number, hour = 9, minute = 41): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function svgImage(color: string, label: string, width = 640, height = 400): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="32" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

let sequence = 0;

export function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  sequence += 1;
  return {
    id: `m-${sequence}`,
    seq: sequence,
    senderId: "u-ana",
    senderName: "Ana Souza",
    createdAt: isoMinutesAgo(30),
    body: "Segue o desvio 045 em anexo.",
    delivery: "sent",
    ...overrides,
  };
}
