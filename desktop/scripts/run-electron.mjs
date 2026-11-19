/**
 * Inicia o Electron do projeto (renderer já buildado ou dev server).
 *
 * Por que este launcher existe: quando o comando é disparado a partir de um
 * terminal hospedado por outro app Electron (VS Code, harness, etc.), a
 * variável ELECTRON_RUN_AS_NODE=1 é herdada e o binário do Electron passa a
 * rodar como Node puro. Nesse modo `require("electron")` devolve o caminho do
 * executável em vez da API, `app` fica undefined e o processo morre na primeira
 * linha do main (`requestSingleInstanceLock`). Removemos a variável para que o
 * Electron sempre suba como aplicativo.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// `require("electron")` fora do Electron devolve o caminho do executável.
const electronBinary = require("electron");

const child = spawn(electronBinary, [projectDir, ...process.argv.slice(2)], {
  cwd: projectDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
