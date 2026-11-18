/**
 * Presença (§6): cinco status + offline.
 * SEMPRE dot + texto/aria — a cor nunca é o único canal.
 * Os rótulos vêm do i18n (`t.status.<status>`), que já cobre os seis valores.
 */
export type PresenceStatus =
  | "available"
  | "busy"
  | "away"
  | "dnd"
  | "invisible"
  | "offline";

/** Status que o usuário pode escolher ativamente (§3). */
export const SELECTABLE_PRESENCE_STATUSES: readonly PresenceStatus[] = [
  "available",
  "busy",
  "away",
  "dnd",
  "invisible",
];

/** Token CSS de cor por status — componente nunca usa hex direto. */
export const PRESENCE_COLOR_TOKEN: Record<PresenceStatus, string> = {
  available: "var(--presence-available)",
  busy: "var(--presence-busy)",
  away: "var(--presence-away)",
  dnd: "var(--presence-dnd)",
  invisible: "var(--presence-invisible)",
  offline: "var(--presence-offline)",
};

/** Tamanho do dot embutido no avatar, proporcional ao tamanho do avatar. */
export function presenceDotSize(avatarSize: number): number {
  return Math.max(8, Math.round(avatarSize * 0.34));
}
