/**
 * Smoke pontual do recado de status via WS (seguir o fluxo do realtime.ts):
 *  1. login → ticket → hello (presença + status_messages);
 *  2. presence.set com status_message → eco presence.changed COM o recado;
 *  3. presence.set com status_message "" (limpar) → eco SEM o campo
 *     (ausência = sem recado — semântica assumida no cliente);
 *  4. presence.set sem status_message (só status) → recado MANTIDO.
 * Uso: SMOKE_BASE=http://127.0.0.1:8667 node tools/smoke-recado.mjs
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:8666";
const USERNAME = "smokeagent";
const PASSWORD = "Smoke!Passw0rd";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label} ${detail}`);
  }
}

async function api(path, { method = "GET", token, body } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : undefined };
}

function nextEvent(socket, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timeout esperando ${type}`));
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

async function main() {
  const login = await api("/auth/login", {
    method: "POST",
    body: { username: USERNAME, password: PASSWORD, device_name: "smoke-recado" },
  });
  check("login", login.status === 200);
  const token = login.data.access_token;
  const myId = login.data.user.id;

  const ticket = await api("/ws/ticket", { method: "POST", token });
  const socket = new WebSocket(
    `${BASE.replace(/^http/, "ws")}/ws?ticket=${encodeURIComponent(ticket.data.ticket)}`,
  );
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("ws não abriu")), { once: true });
  });
  const hello = await nextEvent(socket, "hello");
  check(
    "hello traz presence + status_messages",
    typeof hello.payload.presence === "object" &&
      typeof hello.payload.status_messages === "object" &&
      typeof hello.payload.version === "string",
    JSON.stringify(Object.keys(hello.payload)),
  );

  // (hello emite broadcast_presence de si mesmo logo depois; consumimos)
  await nextEvent(socket, "presence.changed").catch(() => null);

  socket.send(JSON.stringify({ type: "presence.set", status: "busy", status_message: "Em auditoria até 14h" }));
  const setEcho = await nextEvent(socket, "presence.changed");
  check(
    "presence.set com recado → eco com status_message",
    setEcho.payload.user_id === myId &&
      setEcho.payload.status === "busy" &&
      setEcho.payload.status_message === "Em auditoria até 14h",
    JSON.stringify(setEcho.payload),
  );

  // Só status, SEM status_message: o recado deve MANTER no servidor.
  socket.send(JSON.stringify({ type: "presence.set", status: "away" }));
  const keepEcho = await nextEvent(socket, "presence.changed");
  check(
    "presence.set sem status_message mantém o recado",
    keepEcho.payload.user_id === myId &&
      keepEcho.payload.status === "away" &&
      keepEcho.payload.status_message === "Em auditoria até 14h",
    JSON.stringify(keepEcho.payload),
  );

  // String vazia LIMPA o recado — e o eco vem SEM o campo (não null).
  socket.send(JSON.stringify({ type: "presence.set", status: "away", status_message: "" }));
  const clearEcho = await nextEvent(socket, "presence.changed");
  check(
    "presence.set com '' limpa: eco SEM o campo status_message",
    clearEcho.payload.user_id === myId &&
      !("status_message" in clearEcho.payload),
    JSON.stringify(clearEcho.payload),
  );

  socket.close();
  console.log(failures === 0 ? "\nRECADO SMOKE OK" : `\nRECADO SMOKE FALHOU (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke-recado aborted:", error);
  process.exit(1);
});
