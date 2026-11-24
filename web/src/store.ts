/**
 * Fachada do store — o módulo histórico consumido pela UI.
 *
 * A implementação vive em `stores/app-store.ts` (store normalizado por
 * conversa com outbox persistido). Este arquivo mantém o ponto de import
 * estável (`import { useApp } from "./store"`).
 */
export { useApp, STATUS_MESSAGE_MAX_CHARS } from "./stores/app-store";
export type { AppState, SendMessageInput } from "./stores/app-store";
