/**
 * PROVA do fix do preload sandboxed — reproduz as semânticas EXATAS do
 * sandbox do Electron (preload só pode `require("electron")`; qualquer
 * require local falha com "module not found") sem precisar de GUI:
 *
 *  A. REPRODUÇÃO do bug original: o preload compilado pelo pipeline antigo
 *     (tsc, com require("./ipc-contract")) FALHA no sandbox-stub com o mesmo
 *     erro reportado pelo E2E ("module not found ./ipc-contract").
 *  B. PROVA do fix: o bundle atual (electron/dist/preload.js, esbuild
 *     --bundle) CARREGA no sandbox-stub, expõe `window.microzup` COMPLETO
 *     (todos os métodos do allowlist) e faz o round-trip de tokens por IPC.
 *  C. PROVA estrutural: o bundle não contém NENHUM require local (só
 *     require("electron"), permitido no sandbox).
 *
 * Nota: este agente roda em sessão sem window station (Playwright _electron
 * falha com "Process failed to launch!") — a confirmação final no app
 * empacotado é o re-run da suíte E2E do agente e2e.
 *
 * Uso (a partir de desktop/, com npm run build pronto):
 *   node tools/smoke-preload.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label} ${detail}`);
  }
}

function findFile(root, name) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  throw new Error(`${name} não encontrado sob ${root}`);
}

/**
 * Roda um script CJS do preload sob as regras do sandbox do Electron:
 * `require` resolve APENAS o módulo "electron" (stub). Qualquer outro
 * require lança "module not found" — o comportamento exato do preload
 * sandboxed que quebrou o app empacotado.
 */
function runUnderSandboxStub(preloadPath, electronStub) {
  const Module = createRequire(import.meta.url)("node:module");
  const originalLoad = Module._load;
  const entry = path.resolve(preloadPath);
  Module._load = function sandboxedLoad(request) {
    if (request === "electron") return electronStub;
    // O arquivo do preload em si é o ENTRY (carregado pelo runtime, não por
    // require) — na vida real o Electron o executa direto; só o que ELE
    // require cai na regra do sandbox.
    if (path.isAbsolute(request) && path.resolve(request) === entry) {
      return originalLoad.apply(this, arguments);
    }
    throw new Error(
      `Cannot find module '${request}' — preload sandboxed só permite require('electron')`,
    );
  };
  try {
    const requireLocal = createRequire(entry);
    requireLocal(entry);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    Module._load = originalLoad;
  }
}

function makeElectronStub() {
  const exposed = {};
  const invokeHandlers = new Map();
  const tokenStore = new Map();
  // Stub do lado "main": token:save/load/clear gravando em memória (no app
  // real é safeStorage/DPAPI + electron-store, via IPC).
  invokeHandlers.set("token:save", (payload) => {
    tokenStore.set("tokens", payload);
    return true;
  });
  invokeHandlers.set("token:load", () => tokenStore.get("tokens") ?? null);
  invokeHandlers.set("token:clear", () => {
    tokenStore.delete("tokens");
  });
  invokeHandlers.set("app:version", () => "0.1.0-smoke");
  invokeHandlers.set("server:get", () => "http://localhost:8666");
  invokeHandlers.set("prefs:get", () => ({
    theme: "system",
    soundsEnabled: false,
    mutedConversations: [],
    lockTimeoutMinutes: 15,
    closeToTray: true,
    autoAwayMinutes: 10,
    lastServerVersion: null,
  }));
  invokeHandlers.set("outbox:load", () => []);

  const listeners = new Map();
  const ipcRenderer = {
    invoke: async (channel, payload) => {
      const handler = invokeHandlers.get(channel);
      if (handler === undefined) throw new Error(`stub sem handler para o canal ${channel}`);
      return handler(payload);
    },
    on: (channel, callback) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(callback);
    },
    removeListener: (channel, callback) => {
      listeners.get(channel)?.delete(callback);
    },
  };
  const contextBridge = {
    exposeInMainWorld: (name, api) => {
      exposed[name] = api;
    },
  };
  return { exposed, ipcRenderer, contextBridge };
}

const EXPECTED_BRIDGE_METHODS = [
  "getServerUrl", "setServerUrl", "saveTokens", "loadTokens", "clearTokens",
  "getPreferences", "setPreferences", "loadOutbox", "saveOutbox",
  "saveFileDialog", "writeFile", "openFile", "openExternal",
  "minimizeWindow", "toggleMaximize", "closeWindow", "isMaximized",
  "openConversationWindow", "setUnreadCount", "showNotification", "showNudge",
  "lockSession", "getAppVersion", "onSessionLocked", "onIdleAway",
  "onIdleActive", "onOpenConversation", "onWindowMaximized", "onPresenceSetRequested",
];

async function main() {
  console.log("== smoke-preload (sandbox stub do Electron) ==");

  // --- A. reprodução do bug: pipeline antigo (tsc) quebra no sandbox -------
  // (dir temporário DENTRO do workspace: escrita fora dele é negada pelo
  // sandbox desta sessão; removido no finally.)
  const legacyDir = path.join(desktopDir, "tools", ".smoke-legacy-preload");
  fs.rmSync(legacyDir, { recursive: true, force: true });
  fs.mkdirSync(legacyDir, { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [
        path.join("node_modules", "typescript", "bin", "tsc"),
        path.join("electron", "preload.ts"),
        "--ignoreConfig",
        "--module", "Node16",
        "--moduleResolution", "Node16",
        "--target", "ES2022",
        "--esModuleInterop",
        "--skipLibCheck",
        "--outDir", legacyDir,
      ],
      { cwd: desktopDir, stdio: "pipe" },
    );
  } catch (error) {
    console.error("compilação legada falhou:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const legacyStub = makeElectronStub();
  const legacyPreload = findFile(legacyDir, "preload.js");
  const legacy = runUnderSandboxStub(legacyPreload, legacyStub);
  check(
    "A: pipeline antigo (tsc) REPRODUZ o bug — require local falha no sandbox",
    legacy.ok === false && /ipc-contract/i.test(legacy.error ?? ""),
    legacy.error ?? "",
  );
  check(
    "A: …e com isso window.microzup NÃO é exposto",
    legacyStub.exposed.microzup === undefined,
  );

  // --- B. prova do fix: bundle carrega e expõe o bridge completo ----------
  const bundledPath = path.join(desktopDir, "electron", "dist", "preload.js");
  const stub = makeElectronStub();
  const bundled = runUnderSandboxStub(bundledPath, stub);
  check("B: bundle atual CARREGA no sandbox (sem require local)", bundled.ok === true, bundled.error ?? "");
  check("B: window.microzup exposto", typeof stub.exposed.microzup === "object");

  if (stub.exposed.microzup !== undefined) {
    const missing = EXPECTED_BRIDGE_METHODS.filter(
      (method) => typeof stub.exposed.microzup[method] !== "function",
    );
    check(
      "B: todos os métodos do allowlist presentes",
      missing.length === 0,
      `faltando: ${missing.join(", ")}`,
    );

    // Round-trip de tokens pelo IPC stubado (no app real: safeStorage/DPAPI).
    const bridge = stub.exposed.microzup;
    await bridge.saveTokens({ access: "smoke-access", refresh: "smoke-refresh" });
    const loaded = await bridge.loadTokens();
    check(
      "B: round-trip saveTokens → loadTokens via IPC",
      loaded !== null && loaded.access === "smoke-access" && loaded.refresh === "smoke-refresh",
      JSON.stringify(loaded),
    );
    await bridge.clearTokens();
    const cleared = await bridge.loadTokens();
    check("B: clearTokens limpa", cleared === null, JSON.stringify(cleared));
    const version = await bridge.getAppVersion();
    check("B: getAppVersion() responde", version === "0.1.0-smoke", String(version));

    // Inscrição de evento com cleanup (mesma mecânica do preload real).
    let unlocked = false;
    const unsubscribe = bridge.onSessionLocked(() => {
      unlocked = true;
    });
    check("B: onSessionLocked devolve unsubscribe (função)", typeof unsubscribe === "function");
    unsubscribe();
  }

  // --- C. prova estrutural: bundle sem requires locais --------------------
  const source = fs.readFileSync(bundledPath, "utf8");
  const localRequires = source.match(/require\((['"])\.\.?/g) ?? [];
  check("C: bundle NÃO tem require local (autocontido)", localRequires.length === 0, localRequires.join(" "));
  const electronRequires = source.match(/require\((['"])electron\1\)/g) ?? [];
  check(
    "C: único require externo é 'electron' (permitido no sandbox)",
    electronRequires.length >= 1 && !source.replace(/require\((['"])electron\1\)/g, "").includes("require("),
  );

  fs.rmSync(legacyDir, { recursive: true, force: true });

  console.log(
    failures === 0
      ? "\nPRELOAD SMOKE OK — bundle autocontido carrega no sandbox e expõe o bridge completo"
      : `\nPRELOAD SMOKE FALHOU (${failures})`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke-preload fatal:", error);
  fs.rmSync(path.join(desktopDir, "tools", ".smoke-legacy-preload"), { recursive: true, force: true });
  process.exit(1);
});
