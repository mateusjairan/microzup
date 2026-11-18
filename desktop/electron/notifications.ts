/**
 * Notificações nativas com disciplina de ruído (plano-frontend §8.5):
 *  - no máximo 3 toasts por minuto;
 *  - agrupadas por conversa (tag do Windows substitui o toast anterior);
 *  - excedentes viram um único toast "+N mensagens" quando um slot abre;
 *  - clique foca a janela e navega até a conversa (evento ao renderer);
 *  - DND/silenciado/foco são decididos pelo RENDERER (lib/realtime.ts) —
 *    o main apenas mostra o que recebeu;
 *  - sons ficam por conta do renderer (notificações nativas são silenciosas).
 */
import { Notification } from "electron";
import { IPC } from "./ipc-contract";
import type { MessageNotificationRequest, NudgeNotificationRequest } from "./ipc-contract";
import { allAppWindows, focusActiveWindow, getMainWindow } from "./windows";

const MAX_PER_MINUTE = 3;
const WINDOW_MS = 60_000;

const shownAt: number[] = [];
const suppressed = new Map<string, { count: number; title: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function pruneOld(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (shownAt.length > 0 && shownAt[0] < cutoff) shownAt.shift();
}

function withinBudget(): boolean {
  pruneOld();
  return shownAt.length < MAX_PER_MINUTE;
}

function sendToRenderers(channel: string, payload: unknown): void {
  for (const win of allAppWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function show(message: MessageNotificationRequest): void {
  const notification = new Notification({
    title: message.title,
    body: message.body,
    silent: true,
  });
  notification.on("click", () => {
    focusActiveWindow();
    sendToRenderers(IPC.events.openConversation, { conversationId: message.conversationId });
  });
  notification.show();
  shownAt.push(Date.now());
}

function flushSuppressed(): void {
  flushTimer = null;
  if (suppressed.size === 0) return;
  if (!withinBudget()) {
    scheduleFlush();
    return;
  }
  for (const [conversationId, info] of suppressed) {
    if (!withinBudget()) break;
    suppressed.delete(conversationId);
    show({
      title: info.title,
      body: `…e mais ${info.count} mensagens`,
      conversationId,
    });
  }
  if (suppressed.size > 0) scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  pruneOld();
  const wait = shownAt.length > 0 ? WINDOW_MS - (Date.now() - shownAt[0]) + 50 : 100;
  flushTimer = setTimeout(flushSuppressed, wait);
}

export function showMessageNotification(message: MessageNotificationRequest): void {
  if (!Notification.isSupported()) return;
  if (withinBudget()) {
    show(message);
    return;
  }
  const entry = suppressed.get(message.conversationId);
  suppressed.set(message.conversationId, {
    count: (entry?.count ?? 0) + 1,
    title: message.title,
  });
  scheduleFlush();
}

/**
 * "Chamar atenção": flash na barra de tarefas (nunca shake) + toast.
 * Sem limite de taxa aqui — o remetente já se limita a 1/5 min por conversa
 * no cliente, e reduced-motion é respeitado por não tremer a janela.
 * Nudge é raro e importante: sempre passa, sem consumir o orçamento de 3/min.
 */
export function showNudgeNotification(nudge: NudgeNotificationRequest): void {
  const win = getMainWindow();
  win?.flashFrame(true);
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: nudge.title,
    body: nudge.body,
    silent: true,
  });
  notification.on("click", () => {
    focusActiveWindow();
    sendToRenderers(IPC.events.openConversation, { conversationId: nudge.conversationId });
  });
  notification.show();
}

export function stopNotifications(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  suppressed.clear();
}
