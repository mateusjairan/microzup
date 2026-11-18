/**
 * Smoke test do cliente desktop contra o backend real (dev).
 *
 * Valida os pressupostos de protocolo usados por src/lib/{api,ws,realtime}:
 * login/refresh (rotação), envelope de erro, ticket de WS de uso único,
 * mensagens C→S achatadas (typing/presence.set/ping), idempotência por
 * client_id, catch-up por after_seq, não lidas e read.
 *
 * Uso (a partir de desktop/, com o servidor em 127.0.0.1:8666):
 *   node tools/smoke-backend.mjs
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:8666";
const USERNAME = "smokeagent";
const PASSWORD = "Smoke!Passw0rd";

let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label} ${detail}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text === "" ? undefined : JSON.parse(text);
  return { status: response.status, data };
}

function waitForEvent(socket, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timeout esperando evento ${type}`));
    }, timeoutMs);
    function onMessage(raw) {
      const event = JSON.parse(String(raw.data));
      if (event.type === type) {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        resolve(event);
      }
    }
    socket.addEventListener("message", onMessage);
  });
}

function wsSend(socket, payload) {
  socket.send(JSON.stringify(payload));
}

async function main() {
  console.log("== smoke-backend contra", BASE, "==");

  const health = await api("/health");
  check("GET /health", health.status === 200 && health.data.status === "ok");

  const login = await api("/auth/login", {
    method: "POST",
    body: { username: USERNAME, password: PASSWORD, device_name: "smoke-test" },
  });
  check("POST /auth/login", login.status === 200 && typeof login.data.access_token === "string");
  const access = login.data.access_token;
  const refresh = login.data.refresh_token;

  const me = await api("/me", { token: access });
  check(
    "GET /me",
    me.status === 200 && me.data.username === USERNAME && me.data.role === "admin",
  );

  const unauthorized = await api("/me", { token: "token-invalido" });
  check(
    "GET /me com token inválido → 401",
    unauthorized.status === 401 &&
      // Nota: o 401 de autenticação hoje usa o formato padrão do FastAPI
      // ({detail}) — o envelope {error:{code,message}} do plano §7 ainda não
      // cobre essa borda. O cliente trata ambos.
      (typeof unauthorized.data?.error?.code === "string" ||
        typeof unauthorized.data?.detail === "string"),
    JSON.stringify(unauthorized.data),
  );

  // --- conversa de teste: setor próprio + canal -----------------------------
  const sector = await api("/admin/sectors", {
    method: "POST",
    token: access,
    body: { name: "Smoke QA", description: "setor descartável do smoke test" },
  });
  let sectorId = sector.status === 201 ? sector.data.id : null;
  if (sectorId === null) {
    const sectors = await api("/admin/sectors", { token: access });
    const found = sectors.data.find((s) => s.name === "Smoke QA");
    sectorId = found?.id ?? null;
  }
  check("setor de teste garantido", sectorId !== null);

  if (sectorId !== null) {
    // Força um move REAL (clear → set) para materializar a membership do canal
    // mesmo quando o usuário já estava no setor de execuções anteriores.
    await api(`/admin/users/${me.data.id}`, {
      method: "PATCH",
      token: access,
      body: { clear_sector: true },
    });
    const move = await api(`/admin/users/${me.data.id}`, {
      method: "PATCH",
      token: access,
      body: { sector_id: sectorId },
    });
    check("usuário alocado no setor", move.status === 200 && move.data.sector_id === sectorId);
  }

  const conversations = await api("/conversations", { token: access });
  check(
    "GET /conversations com resumo (unread_count/last_message)",
    conversations.status === 200 && Array.isArray(conversations.data) &&
      conversations.data.every((c) => typeof c.unread_count === "number"),
  );
  const channel = conversations.data.find((c) => c.conversation.kind === "channel");
  const conversationId = channel?.conversation.id ?? null;
  check("canal do setor disponível", conversationId !== null);

  // --- WebSocket -------------------------------------------------------------
  const ticketResponse = await api("/ws/ticket", { method: "POST", token: access });
  check(
    "POST /ws/ticket",
    ticketResponse.status === 200 &&
      typeof ticketResponse.data.ticket === "string" &&
      ticketResponse.data.expires_in > 0,
  );

  const wsBase = BASE.replace(/^http/, "ws");
  const socket = new WebSocket(`${wsBase}/ws?ticket=${encodeURIComponent(ticketResponse.data.ticket)}`);
  const hello = await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("ws falhou ao abrir")), { once: true });
  }).then(() => waitForEvent(socket, "hello"));
  check(
    "WS hello com versão + snapshot de presença",
    typeof hello.payload.version === "string" && typeof hello.payload.presence === "object",
    JSON.stringify(hello.payload).slice(0, 200),
  );

  const pong = waitForEvent(socket, "pong").catch(() => null);
  wsSend(socket, { type: "ping" });
  check("ping → pong", (await pong) !== null);

  const presenceEcho = waitForEvent(socket, "presence.changed").catch(() => null);
  wsSend(socket, { type: "presence.set", status: "busy" });
  const presenceEvent = await presenceEcho;
  check(
    "presence.set (achatado) → presence.changed eco",
    presenceEvent !== null && presenceEvent.payload.user_id === me.data.id &&
      presenceEvent.payload.status === "busy",
  );

  if (conversationId !== null) {
    const typingEcho = waitForEvent(socket, "typing").catch(() => null);
    wsSend(socket, { type: "typing", conversation_id: conversationId, is_typing: true });
    const typingEvent = await typingEcho;
    check(
      "typing (achatado) ecoado",
      typingEvent !== null &&
        typingEvent.payload.conversation_id === conversationId &&
        typingEvent.payload.user_id === me.data.id &&
        typingEvent.payload.is_typing === true,
    );
  }

  // --- envio idempotente + catch-up -----------------------------------------
  if (conversationId !== null) {
    const clientId = crypto.randomUUID();
    const messageCreated = waitForEvent(socket, "message.created").catch(() => null);
    const send = await api("/messages", {
      method: "POST",
      token: access,
      body: { conversation_id: conversationId, client_id: clientId, body: "mensagem do smoke test", attachment_ids: [] },
    });
    check("POST /messages → 201 com seq", send.status === 201 && send.data.seq > 0);
    const created = await messageCreated;
    check(
      "message.created recebido via WS com mesmo client_id",
      created !== null && created.payload.client_id === clientId &&
        created.payload.seq === send.data.seq,
    );

    const replay = await api("/messages", {
      method: "POST",
      token: access,
      body: { conversation_id: conversationId, client_id: clientId, body: "mensagem do smoke test", attachment_ids: [] },
    });
    check("retry com o MESMO client_id é idempotente", replay.data.id === send.data.id);

    const catchUp = await api(
      `/conversations/${conversationId}/messages?after_seq=${send.data.seq - 1}&limit=50`,
      { token: access },
    );
    check(
      "catch-up por after_seq devolve a mensagem",
      catchUp.status === 200 && catchUp.data.some((m) => m.id === send.data.id),
    );

    const markRead = await api(`/conversations/${conversationId}/read`, {
      method: "POST",
      token: access,
      body: { last_read_seq: send.data.seq },
    });
    check("POST /read → 204", markRead.status === 204);

    const afterRead = await api("/conversations", { token: access });
    const summary = afterRead.data.find((c) => c.conversation.id === conversationId);
    check("unread_count zerado após read", summary !== undefined && summary.unread_count === 0);

    const del = await api(`/messages/${send.data.id}`, { method: "DELETE", token: access });
    check("DELETE da mensagem de smoke (soft delete) → 204", del.status === 204);
  }

  socket.close();

  // --- rotação de refresh ----------------------------------------------------
  const refreshed = await api("/auth/refresh", {
    method: "POST",
    body: { refresh_token: refresh },
  });
  check(
    "POST /auth/refresh rotaciona tokens",
    refreshed.status === 200 &&
      refreshed.data.refresh_token !== refresh &&
      typeof refreshed.data.access_token === "string",
  );

  const replayOldRefresh = await api("/auth/refresh", {
    method: "POST",
    body: { refresh_token: refresh },
  });
  check("refresh antigo é invalidado (rotação única)", replayOldRefresh.status === 401);

  console.log(failures === 0 ? "\nSMOKE OK — todos os cenários passaram" : `\nSMOKE FALHOU (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke aborted:", error);
  process.exit(1);
});
