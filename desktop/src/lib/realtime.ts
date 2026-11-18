/**
 * Orquestração em tempo real: liga o WsClient ao store e à casca Electron.
 *
 *  - estados de conexão no store (online | reconnecting(n) | offline | sessionExpired);
 *  - catch-up por `seq` ao reconectar e em lacunas detectadas (plano-mvp §7);
 *  - não lidas ao vivo + preview da última mensagem + badge da bandeja;
 *  - typing com expiração de ~5 s na recepção e throttle de 3 s no envio;
 *  - presença: presence.set no WS, auto-ausente por inatividade do SO (IPC);
 *  - nudge ("chamar atenção") com limite de 1 por conversa a cada 5 min;
 *  - notificações nativas com a matriz plano-frontend §8.5 (DND/silenciado/foco);
 *  - fila de envio (outbox) é reenviada quando a conexão volta.
 */
import { endpoints, onSessionExpired } from "./api";
import { WsClient } from "./ws";
import type { WsStatus } from "./ws";
import {
  onIdleActive,
  onIdleAway,
  onOpenConversation,
  onPresenceSetRequested,
  onSessionLocked,
  setUnreadCount,
  showNudge,
  showNotification,
} from "./bridge";
import { useApp } from "../store";
import type { MessageCreatedPayload, TypingPayload, WsEnvelope } from "../types/ws";
import { parsePresence } from "../types/client";
import { t } from "../i18n/pt-BR";

const TYPING_SEND_THROTTLE_MS = 3_000;
const TYPING_RECEIVE_EXPIRY_MS = 5_000;
const TYPING_SEND_STOP_MS = 6_000;
const NUDGE_MIN_INTERVAL_MS = 5 * 60 * 1000;

let ws: WsClient | null = null;
let running = false;
const cleanupFns: Array<() => void> = [];

const typingSendAt = new Map<string, number>();
const typingStopTimer = new Map<string, ReturnType<typeof setTimeout>>();
const typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const nudgeSentAt = new Map<string, number>();
const backfillInFlight = new Set<string>();
let lastUnreadTotal = -1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ---------------------------------------------------------------------------
// Typing (envio com throttle de 3 s; recepção com expiração de 5 s)
// ---------------------------------------------------------------------------

/** Composer chama a cada tecla — envia no máximo 1 evento a cada 3 s. */
export function notifyTyping(conversationId: string): void {
  if (ws === null || !ws.isConnected()) return;
  const last = typingSendAt.get(conversationId) ?? 0;
  if (Date.now() - last < TYPING_SEND_THROTTLE_MS) return;
  typingSendAt.set(conversationId, Date.now());
  ws.send({ type: "typing", conversation_id: conversationId, is_typing: true });

  const stopTimer = typingStopTimer.get(conversationId);
  if (stopTimer !== undefined) clearTimeout(stopTimer);
  typingStopTimer.set(
    conversationId,
    setTimeout(() => {
      typingStopTimer.delete(conversationId);
      typingSendAt.delete(conversationId);
      ws?.send({ type: "typing", conversation_id: conversationId, is_typing: false });
    }, TYPING_SEND_STOP_MS),
  );
}

/** Para o indicador imediatamente (mensagem enviada / campo vazio / blur). */
export function stopTypingNotification(conversationId: string): void {
  const stopTimer = typingStopTimer.get(conversationId);
  if (stopTimer !== undefined) {
    clearTimeout(stopTimer);
    typingStopTimer.delete(conversationId);
  }
  typingSendAt.delete(conversationId);
  ws?.send({ type: "typing", conversation_id: conversationId, is_typing: false });
}

function handleTypingEvent(payload: TypingPayload): void {
  const state = useApp.getState();
  state.setTyping(payload.conversation_id, payload.user_id, payload.is_typing);
  if (!payload.is_typing) return;
  const key = `${payload.conversation_id}:${payload.user_id}`;
  const existing = typingExpiryTimers.get(key);
  if (existing !== undefined) clearTimeout(existing);
  typingExpiryTimers.set(
    key,
    setTimeout(() => {
      typingExpiryTimers.delete(key);
      useApp.getState().setTyping(payload.conversation_id, payload.user_id, false);
    }, TYPING_RECEIVE_EXPIRY_MS),
  );
}

// ---------------------------------------------------------------------------
// Nudge ("chamar atenção")
// ---------------------------------------------------------------------------

/** Envia o nudge; retorna false quando o limite de 1/5 min por conversa bate. */
export function sendNudge(conversationId: string): boolean {
  if (ws === null || !ws.isConnected()) return false;
  const last = nudgeSentAt.get(conversationId) ?? 0;
  if (Date.now() - last < NUDGE_MIN_INTERVAL_MS) return false;
  nudgeSentAt.set(conversationId, Date.now());
  ws.send({ type: "nudge", conversation_id: conversationId });
  return true;
}

function handleNudgeEvent(conversationId: string, fromUserId: string, senderName: string | null): void {
  const state = useApp.getState();
  const event = {
    conversationId,
    fromUserId,
    at: Date.now(),
  };
  state.setLastNudge(event);
  // DND e conversa silenciada suprimem o efeito local (plano-frontend §8.4).
  if (state.myStatus === "dnd") return;
  if (state.mutedConversations.includes(conversationId)) return;

  const fallback = state.users.find((u) => u.id === fromUserId)?.display_name;
  const name = senderName ?? fallback ?? t.nav.unknownUser;
  void showNudge({
    title: t.appName,
    body: t.nudge.received.replace("{name}", name),
    conversationId,
  });
}

// ---------------------------------------------------------------------------
// Notificações de mensagem (matriz plano-frontend §8.5)
// ---------------------------------------------------------------------------

function notifyIncomingMessage(message: MessageCreatedPayload): void {
  const state = useApp.getState();
  if (state.user !== null && message.sender_id === state.user.id) return;
  // Janela focada na conversa ativa → sem toast (badge limpa via markRead).
  if (state.activeConversationId === message.conversation_id && state.windowFocused) return;
  if (state.myStatus === "dnd") return;
  if (state.mutedConversations.includes(message.conversation_id)) return;

  const sender = state.users.find((u) => u.id === message.sender_id);
  const summary = state.conversations.find(
    (c) => c.conversation.id === message.conversation_id,
  );
  const conversationName =
    summary?.conversation.kind === "dm"
      ? null
      : summary?.conversation.name;
  const title =
    conversationName === null || conversationName === undefined
      ? (sender?.display_name ?? t.appName)
      : `${sender?.display_name ?? t.appName} · ${conversationName}`;
  const body =
    message.body.trim() === "" && (message.attachment_ids?.length ?? 0) > 0
      ? t.notifications.attachment
      : message.body;
  void showNotification({ title, body, conversationId: message.conversation_id });
}

function syncTrayBadge(state: { conversations: Array<{ unread_count: number }> }): void {
  const total = state.conversations.reduce((sum, c) => sum + c.unread_count, 0);
  if (total !== lastUnreadTotal) {
    lastUnreadTotal = total;
    void setUnreadCount(total);
  }
}

// ---------------------------------------------------------------------------
// Catch-up por seq (plano-mvp §7 — offline → online)
// ---------------------------------------------------------------------------

async function backfillConversation(conversationId: string, afterSeq: number): Promise<void> {
  if (backfillInFlight.has(conversationId)) return;
  backfillInFlight.add(conversationId);
  try {
    let cursor = afterSeq;
    // Lacunas grandes podem exigir várias páginas; 5 rodadas cobrem 1000 msgs.
    for (let round = 0; round < 5; round += 1) {
      const messages = await endpoints.listMessages(conversationId, {
        afterSeq: cursor,
        limit: 200,
      });
      if (messages.length === 0) break;
      useApp.getState().appendMessages(conversationId, messages);
      cursor = messages[messages.length - 1].seq;
      if (messages.length < 200) break;
    }
  } catch {
    /* o próximo evento de mensagem ou reconexão reexecuta o catch-up */
  } finally {
    backfillInFlight.delete(conversationId);
  }
}

async function catchUpAfterReconnect(): Promise<void> {
  try {
    const summaries = await endpoints.listConversations();
    useApp.getState().setConversations(summaries);
  } catch {
    return;
  }
  const fresh = useApp.getState();
  const cursors: Array<[string, number]> = Object.entries(fresh.lastSeqByConversation);
  for (const [conversationId, lastSeq] of cursors) {
    const summary = fresh.conversations.find((c) => c.conversation.id === conversationId);
    const serverSeq = summary?.last_message?.seq ?? 0;
    if (serverSeq > lastSeq) {
      void backfillConversation(conversationId, lastSeq);
    }
  }
  // Reenvia mensagens que estavam na fila (offline/falha) — mesmo client_id.
  void useApp.getState().flushOutbox();
  // A versão nova do servidor também pode trazer presenças novas.
  try {
    const users = await endpoints.listDirectoryUsers();
    useApp.getState().setUsers(users);
  } catch {
    /* diretorio é best-effort no catch-up */
  }
}

// ---------------------------------------------------------------------------
// Eventos do WebSocket
// ---------------------------------------------------------------------------

function parseTypingPayload(payload: Record<string, unknown>): TypingPayload | null {
  if (typeof payload.conversation_id !== "string" || typeof payload.user_id !== "string") {
    return null;
  }
  return {
    conversation_id: payload.conversation_id,
    user_id: payload.user_id,
    is_typing: payload.is_typing === true,
  };
}

function parseMessagePayload(payload: Record<string, unknown>): MessageCreatedPayload | null {
  if (
    typeof payload.id !== "string" ||
    typeof payload.conversation_id !== "string" ||
    typeof payload.sender_id !== "string" ||
    typeof payload.client_id !== "string" ||
    typeof payload.body !== "string" ||
    typeof payload.created_at !== "string" ||
    typeof payload.seq !== "number"
  ) {
    return null;
  }
  return {
    id: payload.id,
    seq: payload.seq,
    conversation_id: payload.conversation_id,
    sender_id: payload.sender_id,
    client_id: payload.client_id,
    body: payload.body,
    created_at: payload.created_at,
    edited_at: typeof payload.edited_at === "string" ? payload.edited_at : null,
    deleted_at: typeof payload.deleted_at === "string" ? payload.deleted_at : null,
    attachment_ids: Array.isArray(payload.attachment_ids)
      ? payload.attachment_ids.filter((id): id is string => typeof id === "string")
      : undefined,
  };
}

function handleEvent(event: WsEnvelope): void {
  const state = useApp.getState();
  switch (event.type) {
    case "hello": {
      if (isRecord(event.payload) && isRecord(event.payload.presence)) {
        for (const [userId, value] of Object.entries(event.payload.presence)) {
          const status = parsePresence(value);
          if (status !== null) state.setPresence(userId, status);
        }
      }
      // Recados de status ativos dos pares (snapshot do hub).
      if (isRecord(event.payload) && isRecord(event.payload.status_messages)) {
        for (const [userId, note] of Object.entries(event.payload.status_messages)) {
          if (typeof note === "string" && note !== "") {
            state.setStatusNote(userId, note);
          }
        }
      }
      if (isRecord(event.payload) && typeof event.payload.version === "string") {
        state.applyServerVersion(event.payload.version);
      }
      break;
    }
    case "message.created": {
      if (!isRecord(event.payload)) break;
      const message = parseMessagePayload(event.payload);
      if (message === null) break;
      const lastSeq = state.lastSeqByConversation[message.conversation_id] ?? 0;
      state.applyIncomingMessage(message);
      // Lacuna de seq → refetch por after_seq (plano-mvp §6).
      if (message.seq > lastSeq + 1) {
        void backfillConversation(message.conversation_id, lastSeq);
      }
      notifyIncomingMessage(message);
      // Typing de quem enviou obviamente terminou.
      state.setTyping(message.conversation_id, message.sender_id, false);
      // Interim (paridade com o comportamento anterior): conversa ativa com
      // janela focada marca como lida na hora. O plano §8.2 refina para
      // "1 s com janela focada" — o agendamento fino fica na UI, a chamada
      // (store.markRead) é desta camada.
      if (
        useApp.getState().activeConversationId === message.conversation_id &&
        useApp.getState().windowFocused
      ) {
        useApp.getState().markRead(message.conversation_id);
      }
      break;
    }
    case "message.updated": {
      if (!isRecord(event.payload)) break;
      const message = parseMessagePayload(event.payload);
      if (message === null) break;
      state.updateMessage(message);
      break;
    }
    case "message.deleted": {
      if (!isRecord(event.payload)) break;
      const conversationId = event.payload.conversation_id;
      const messageId = event.payload.message_id;
      if (typeof conversationId === "string" && typeof messageId === "string") {
        state.removeMessage(conversationId, messageId);
      }
      break;
    }
    case "presence.changed": {
      if (isRecord(event.payload) && typeof event.payload.user_id === "string") {
        const userId = event.payload.user_id;
        const status = parsePresence(event.payload.status);
        if (status !== null) state.setPresence(userId, status);
        // O hub inclui `status_message` apenas quando há recado ativo — a
        // ausência do campo significa "sem recado agora" (payload sempre
        // reconstruído do estado do hub em cada broadcast).
        const note =
          typeof event.payload.status_message === "string" &&
          event.payload.status_message !== ""
            ? event.payload.status_message
            : null;
        state.setStatusNote(userId, note);
      }
      break;
    }
    case "typing": {
      if (!isRecord(event.payload)) break;
      const typing = parseTypingPayload(event.payload);
      if (typing !== null) handleTypingEvent(typing);
      break;
    }
    case "read.updated": {
      if (
        isRecord(event.payload) &&
        typeof event.payload.conversation_id === "string" &&
        typeof event.payload.user_id === "string" &&
        typeof event.payload.last_read_seq === "number"
      ) {
        state.setLastRead(
          event.payload.conversation_id,
          event.payload.user_id,
          event.payload.last_read_seq,
        );
      }
      break;
    }
    case "nudge": {
      if (
        isRecord(event.payload) &&
        typeof event.payload.conversation_id === "string" &&
        typeof event.payload.sender_id === "string"
      ) {
        const senderName =
          typeof event.payload.sender_name === "string" ? event.payload.sender_name : null;
        handleNudgeEvent(event.payload.conversation_id, event.payload.sender_id, senderName);
      }
      break;
    }
    case "nudge.refused": {
      // Servidor recusou (throttle/permissão): alinha o cooldown do cliente ao
      // do servidor para a UI continuar mostrando o aviso de espera.
      if (isRecord(event.payload) && typeof event.payload.conversation_id === "string") {
        nudgeSentAt.set(event.payload.conversation_id, Date.now());
      }
      break;
    }
    default:
      break;
  }
}

function handleStatus(status: WsStatus, attempt: number): void {
  const state = useApp.getState();
  if (status === "sessionExpired") {
    state.setSessionExpired(true);
    state.setConnection("sessionExpired", 0);
    return;
  }
  state.setConnection(status, attempt);
  if (status === "online") {
    // O hub reseta presença E recado por conexão (estado por socket):
    // reaplica o status escolhido e o recado ativo do store.
    const myStatus = state.myStatus;
    if (myStatus !== "offline") {
      const note = useApp.getState().statusMessage?.text ?? "";
      ws?.send({ type: "presence.set", status: myStatus, status_message: note });
    }
    void catchUpAfterReconnect();
  }
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

export function startRealtime(): () => void {
  if (running) return stopRealtime;
  running = true;

  ws = new WsClient();
  ws.onStatus(handleStatus);
  ws.onEvent(handleEvent);
  void ws.connect();

  // Foco da janela alimenta a regra de não lidas/notificações (§8.5).
  const onFocus = () => useApp.getState().setWindowFocused(true);
  const onBlur = () => useApp.getState().setWindowFocused(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  useApp.getState().setWindowFocused(document.hasFocus());
  cleanupFns.push(() => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  });

  // Rede voltou → reconecta na hora, sem esperar o backoff.
  const onNetworkOnline = () => ws?.retryNow();
  window.addEventListener("online", onNetworkOnline);
  cleanupFns.push(() => window.removeEventListener("online", onNetworkOnline));

  // Sessão expirada de vez (refresh falhou): estado + parar de reconectar.
  const unsubscribeSessionExpired = onSessionExpired(() => {
    const state = useApp.getState();
    state.setSessionExpired(true);
    state.setConnection("sessionExpired", 0);
    ws?.close();
  });
  cleanupFns.push(unsubscribeSessionExpired);

  // Auto-ausente por inatividade do SO (powerMonitor via IPC).
  cleanupFns.push(
    onIdleAway(() => useApp.getState().setAutoAway(true)),
    onIdleActive(() => useApp.getState().restoreFromAutoAway()),
  );

  // Bloqueio de sessão por inatividade — a UI desenha o overlay.
  cleanupFns.push(onSessionLocked(() => useApp.getState().setSessionLocked(true)));

  // Clique em notificação/toast → abre a conversa (main foca a janela).
  cleanupFns.push(
    onOpenConversation((conversationId) => {
      useApp.getState().setActiveConversation(conversationId);
    }),
  );

  // Menu de status da bandeja.
  cleanupFns.push(
    onPresenceSetRequested((status) => {
      useApp.getState().setMyStatus(status);
    }),
  );

  // myStatus ou recado mudaram (UI/tray) → presence.set no servidor.
  // Semântica do status_message no servidor: omitido MANTÉM o recado,
  // texto não-vazio define, string vazia LIMPA. Abrir conversa com a janela
  // focada marca como lida (interim; §8.2 refina o tempo na UI).
  const unsubscribeMyStatus = useApp.subscribe((state, prevState) => {
    const statusChanged =
      state.myStatus !== prevState.myStatus && state.myStatus !== "offline";
    const noteChanged = state.statusMessage !== prevState.statusMessage;
    if (statusChanged || noteChanged) {
      const status = state.myStatus;
      if (status !== "offline") {
        if (noteChanged) {
          ws?.send({
            type: "presence.set",
            status,
            status_message: state.statusMessage?.text ?? "",
          });
        } else {
          ws?.send({ type: "presence.set", status });
        }
      }
    }
    if (
      state.activeConversationId !== prevState.activeConversationId &&
      state.activeConversationId !== null &&
      state.windowFocused
    ) {
      state.markRead(state.activeConversationId);
    }
    if (
      state.conversations !== prevState.conversations ||
      state.activeConversationId !== prevState.activeConversationId ||
      state.windowFocused !== prevState.windowFocused
    ) {
      syncTrayBadge(state);
    }
  });
  cleanupFns.push(unsubscribeMyStatus);

  // Recado expira sozinho (8 h).
  const statusMessageTimer = setInterval(() => useApp.getState().expireStatusMessage(), 60_000);
  cleanupFns.push(() => clearInterval(statusMessageTimer));

  syncTrayBadge(useApp.getState());

  return stopRealtime;
}

export function stopRealtime(): void {
  if (!running) return;
  running = false;
  for (const cleanup of cleanupFns.splice(0)) cleanup();
  ws?.close();
  ws = null;
  for (const timer of typingExpiryTimers.values()) clearTimeout(timer);
  typingExpiryTimers.clear();
  for (const timer of typingStopTimer.values()) clearTimeout(timer);
  typingStopTimer.clear();
  typingSendAt.clear();
  nudgeSentAt.clear();
  backfillInFlight.clear();
}

/**
 * "Tentar agora" (ReconnectBanner §8.5): tenta reconectar AGORA, cancelando o
 * backoff pendente — sem recriar o pipeline (listeners, timers, outbox).
 * Não faz nada se já conectado ou com sessão expirada.
 */
export function retryNow(): void {
  ws?.retryNow();
}

/** Reinicia o pipeline (ex.: depois de reautenticar uma sessão expirada). */
export function restartRealtime(): void {
  stopRealtime();
  useApp.getState().setSessionExpired(false);
  startRealtime();
}
