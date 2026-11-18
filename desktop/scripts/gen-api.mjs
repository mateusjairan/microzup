/**
 * gen:api — regenera src/types/api.ts a partir do OpenAPI do backend.
 *
 * Etapas:
 *  1. Garante as dependências do sandbox tools/gen-api (openapi-typescript
 *     precisa da API JS do TypeScript 5; o projeto usa o compilador nativo
 *     TS 7, que não a expõe — por isso o gerador roda com o TS 5 do sandbox).
 *  2. Extrai o schema OpenAPI do FastAPI (server/) para desktop/openapi.json.
 *  3. Roda openapi-typescript gerando desktop/src/types/api.ts.
 *
 * Uso: npm run gen:api
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(desktopDir, "..");
const toolsDir = path.join(desktopDir, "tools", "gen-api");
const cliPath = path.join(toolsDir, "node_modules", "openapi-typescript", "bin", "cli.js");
const openapiPath = path.join(desktopDir, "openapi.json");

const DUMP_OPENAPI =
  "from app.main import app; import json; print(json.dumps(app.openapi()))";

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, shell?: boolean, env?: NodeJS.ProcessEnv, capture?: boolean }} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      env: options.env,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr: "" });
      else reject(new Error(`${command} ${args.join(" ")} saiu com código ${code}`));
    });
  });
}

async function main() {
  if (!existsSync(cliPath)) {
    console.log("[gen:api] instalando ferramentas do sandbox (openapi-typescript + TS5)…");
    const env = { ...process.env, npm_config_cache: path.join(desktopDir, ".npm-cache") };
    await run("npm", ["install", "--silent", "--no-audit", "--no-fund"], {
      cwd: toolsDir,
      shell: process.platform === "win32",
      env,
    });
  }

  console.log("[gen:api] extraindo OpenAPI do backend (uv run python)…");
  const { stdout } = await run("uv", ["run", "python", "-c", DUMP_OPENAPI], {
    cwd: path.join(repoDir, "server"),
    capture: true,
  });
  writeFileSync(openapiPath, stdout.trimEnd() + "\n", "utf8");

  console.log("[gen:api] gerando src/types/api.ts…");
  await run(process.execPath, [cliPath, "openapi.json", "--output", "src/types/api.ts"], {
    cwd: desktopDir,
  });
  console.log("[gen:api] pronto: src/types/api.ts");
}

main().catch((error) => {
  console.error(`[gen:api] falhou: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
