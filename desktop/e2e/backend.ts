/**
 * Ciclo de vida do backend real nos testes E2E.
 *
 * O servidor sobe como subprocesso `uv run python -m app.run` a partir de
 * server/ (entry que força SelectorEventLoop — NUNCA `uvicorn` sem --reload
 * no Windows, bug documentado pelo agente backend). APP_ENV=test faz o log
 * estruturado ir para stdout (redirecionado a arquivo) sem rotação diária.
 *
 * O PID é trocado entre processos via arquivo (globalSetup roda no runner;
 * specs rodam no worker) — specs de resiliência matam/religam o servidor com
 * os mesmos utilitários daqui.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { BACKEND_PORT, E2E_TMP, SERVER_DIR } from "./constants";

const LOG_PATH = path.join(E2E_TMP, "backend.log");
const PID_PATH = path.join(E2E_TMP, "backend.pid");

let child: ChildProcess | null = null;

function ensureTmp(): void {
  fs.mkdirSync(E2E_TMP, { recursive: true });
}

function portInUse(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: BACKEND_PORT });
    const done = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_500, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

async function waitFor(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(500);
  }
  throw new Error(`E2E: timeout aguardando ${label} (${timeoutMs} ms)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(pathname: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}${pathname}`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`GET ${pathname} → ${response.status}`);
  return response.json();
}

/** Sobe o backend e falha EXPLICITAMENTE se não conseguir (nunca "passa" sem backend). */
export async function startBackend(): Promise<void> {
  ensureTmp();
  if (await portInUse()) {
    throw new Error(
      `E2E: a porta ${BACKEND_PORT} já está ocupada — outro servidor está no ar. ` +
        "Encerre-o antes de rodar a suíte (a suíte nunca reutiliza um backend que não subiu ela mesma).",
    );
  }

  const logFd = fs.openSync(LOG_PATH, "a");
  child = spawn("uv", ["run", "python", "-m", "app.run"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(BACKEND_PORT), APP_ENV: "test" },
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  fs.writeFileSync(PID_PATH, String(child.pid));

  child.on("exit", () => {
    if (child !== null && child.pid !== null && String(child.pid) === fs.readFileSync(PID_PATH, "utf8")) {
      fs.rmSync(PID_PATH, { force: true });
    }
  });

  const pid = child.pid ?? 0;
  try {
    // /health não toca no banco; /health/db comprova o Postgres.
    await waitFor("GET /health", async () => {
      try {
        return ((await fetchJson("/health")) as { status?: string }).status === "ok";
      } catch {
        return false;
      }
    }, 60_000);
    await waitFor("GET /health/db", async () => {
      try {
        return ((await fetchJson("/health/db")) as { status?: string }).status === "ok";
      } catch {
        return false;
      }
    }, 30_000);
  } catch (error) {
    killPid(pid);
    const tail = fs.existsSync(LOG_PATH)
      ? fs.readFileSync(LOG_PATH, "utf8").split(/\r?\n/).slice(-40).join("\n")
      : "(sem log)";
    throw new Error(`E2E: o backend não subiu na porta ${BACKEND_PORT}.\n${error}\n--- log ---\n${tail}`);
  }
}

function killPid(pid: number): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
}

/** Mata o backend atual (PID gravado no arquivo) e espera a porta liberar. */
export async function stopBackend(): Promise<void> {
  const pidText = fs.existsSync(PID_PATH) ? fs.readFileSync(PID_PATH, "utf8").trim() : "";
  const pid = Number(pidText);
  if (pidText !== "" && Number.isFinite(pid)) {
    killPid(pid);
    fs.rmSync(PID_PATH, { force: true });
  }
  child = null;

  if (await portInUse()) {
    // Fallback: identifica o dono da porta via netstat (pode ser um restart
    // de spec que gravou PID novo antes de cair).
    const netstat = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const line = netstat.stdout
      ?.split(/\r?\n/)
      .find((row) => row.includes(`:${BACKEND_PORT} `) && row.includes("LISTENING"));
    const owner = line?.trim().split(/\s+/).pop();
    if (owner !== undefined && /^\d+$/.test(owner)) killPid(Number(owner));
  }
  await waitFor(`porta ${BACKEND_PORT} liberar`, async () => !(await portInUse()), 20_000);
}

/** Mata e sobe de novo (specs de envio com falha e de reconexão/catch-up). */
export async function restartBackend(): Promise<void> {
  await stopBackend();
  await startBackend();
}

/** Log do backend (para diagnóstico em falha). */
export function backendLogPath(): string {
  return LOG_PATH;
}
