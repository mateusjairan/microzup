/**
 * globalSetup da suíte E2E (autocontida):
 *  1. sobe o backend real (`uv run python -m app.run`, porta 8666, log em
 *     e2e/.tmp/backend.log) — FALHA explicitamente se não subir;
 *  2. cria as fixtures idempotentes no banco de dev (sem apagar nada):
 *     - admin `e2eadmin` via CLI `create-admin` (stdin, nunca em argumento);
 *     - setor "E2E Qualidade" + canal via POST /admin/sectors;
 *     - `e2e.alice` e `e2e.bruno` via POST /admin/users (409 → reset de senha).
 *
 * O login tem rate limit de 10/min POR IP no servidor — o setup usa UM único
 * login de admin (token reutilizado) + um login por membro no sanity check,
 * deixando folga larga para os logins da UI das specs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  E2E_PASSWORD,
  E2E_TMP,
  ADMIN,
  ALICE,
  BRUNO,
  SECTOR_NAME,
  SERVER_DIR,
  WEB_DIST_DIR,
} from "./constants";
import { startBackend, stopBackend } from "./backend";
import { apiLogin, apiPost, apiGet, listUsers, listSectors, ApiHttpError } from "./api";

/** Bootstrap do primeiro admin; devolve o token para as demais chamadas. */
async function ensureAdmin(): Promise<string> {
  try {
    return (await apiLogin(ADMIN.username, ADMIN.password)).access_token;
  } catch {
    // primeira vez (ou senha divergente) — cria via CLI e tenta de novo
  }

  const result = spawnSync(
    "uv",
    [
      "run",
      "python",
      "-m",
      "app.cli",
      "create-admin",
      "--username",
      ADMIN.username,
      "--display-name",
      ADMIN.displayName,
    ],
    {
      cwd: SERVER_DIR,
      input: `${E2E_PASSWORD}\n${E2E_PASSWORD}\n`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0 && !/já existe/.test(result.stdout ?? "")) {
    throw new Error(`E2E: create-admin falhou (${result.status})\n${result.stderr ?? ""}`);
  }
  try {
    return (await apiLogin(ADMIN.username, ADMIN.password)).access_token;
  } catch {
    throw new Error(
      `E2E: o usuário '${ADMIN.username}' existe com uma senha DIFERENTE da fixture. ` +
        "Desative-o manualmente (ou remova do banco de dev) e rode a suíte de novo — " +
        "o create-admin é idempotente e não sobrescreve senha.",
    );
  }
}

async function ensureSector(adminToken: string): Promise<string> {
  try {
    const sector = await apiPost<{ id: string; name: string }>(adminToken, "/admin/sectors", {
      name: SECTOR_NAME,
      description: "Setor usado exclusivamente pela suíte E2E",
    });
    return sector.id;
  } catch (error) {
    if (!(error instanceof ApiHttpError) || error.code !== "sector_already_exists") throw error;
    const sectors = await listSectors(adminToken);
    const existing = sectors.find((sector) => sector.name === SECTOR_NAME);
    if (existing === undefined) throw error;
    return existing.id;
  }
}

async function ensureMember(
  adminToken: string,
  username: string,
  displayName: string,
  sectorId: string,
): Promise<void> {
  try {
    await apiPost(adminToken, "/admin/users", {
      username,
      display_name: displayName,
      password: E2E_PASSWORD,
      role: "member",
      sector_id: sectorId,
    });
    return;
  } catch (error) {
    if (!(error instanceof ApiHttpError) || error.code !== "user_already_exists") throw error;
  }

  // Já existe (rodada anterior): alinha a senha com o reset do admin.
  const users = await listUsers(adminToken, true);
  const user = users.find((entry) => entry.username === username);
  if (user === undefined) throw new Error(`E2E: usuário '${username}' sumiu do diretório`);
  await apiPost(adminToken, `/admin/users/${user.id}/password`, { new_password: E2E_PASSWORD });
}

export default async function globalSetup(): Promise<void> {
  // O backend serve o SPA de web/dist: sem build, a suíte testaria um 404.
  if (!fs.existsSync(path.join(WEB_DIST_DIR, "index.html"))) {
    throw new Error(
      "E2E: web/dist/index.html não existe. Rode `npm run build` antes (ou use `npm run test:e2e`, que compila).",
    );
  }

  fs.rmSync(E2E_TMP, { recursive: true, force: true });
  fs.mkdirSync(E2E_TMP, { recursive: true });

  await startBackend();
  try {
    const adminToken = await ensureAdmin();
    const sectorId = await ensureSector(adminToken);
    await ensureMember(adminToken, ALICE.username, ALICE.displayName, sectorId);
    await ensureMember(adminToken, BRUNO.username, BRUNO.displayName, sectorId);

    // Sanity: os dois membros logam e veem o canal do setor.
    for (const member of [ALICE, BRUNO]) {
      const login = await apiLogin(member.username, member.password);
      const conversations = await apiGet<Array<{ conversation: { name: string | null } }>>(
        login.access_token,
        "/conversations",
      );
      const hasChannel = conversations.some((entry) => entry.conversation.name === SECTOR_NAME);
      if (!hasChannel) {
        throw new Error(`E2E: ${member.username} não entrou no canal do setor ${SECTOR_NAME}`);
      }
    }
  } catch (error) {
    await stopBackend();
    throw error;
  }

  console.log(
    "[e2e] backend + SPA no ar em http://127.0.0.1:8666; fixtures e2eadmin/e2e.alice/e2e.bruno prontos",
  );
}
