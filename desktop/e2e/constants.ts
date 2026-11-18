/**
 * Constantes da suíte E2E do Microzup (plano-frontend §14).
 *
 * Credencial de fixture: `E2E_PASSWORD` existe APENAS no banco de dev para os
 * usuários `e2e.*` criados pelo globalSetup — não é um segredo do produto.
 */
import path from "node:path";

/** Porta fixa do backend de teste (mesma do .env do servidor: PORT=8666). */
export const BACKEND_PORT = 8666;

export const BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;

/** Senha comum dos usuários de fixture (dev DB — não é segredo real). */
export const E2E_PASSWORD = "Microzup-E2E-2026";

export interface TestUser {
  username: string;
  password: string;
  displayName: string;
}

/** Admin de fixture (criado via CLI `create-admin`, idempotente). */
export const ADMIN: TestUser = {
  username: "e2eadmin",
  password: E2E_PASSWORD,
  displayName: "E2E Admin",
};

/** Usuária principal da suíte (member, setor E2E). */
export const ALICE: TestUser = {
  username: "e2e.alice",
  password: E2E_PASSWORD,
  displayName: "Alice E2E",
};

/** Par da Alice — alimenta via REST/segunda janela (WS e mensagens). */
export const BRUNO: TestUser = {
  username: "e2e.bruno",
  password: E2E_PASSWORD,
  displayName: "Bruno Lima (E2E)",
};

export const SECTOR_NAME = "E2E Qualidade";

/** Canal do setor — alice e bruno são membros. */
export const CHANNEL_NAME = SECTOR_NAME;

/** Diretório de temporários da suíte (apagado no globalSetup/globalTeardown). */
export const E2E_TMP = path.join(__dirname, ".tmp");

/** Raiz do checkout (server/, desktop/). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Pasta desktop/ (cwd do Playwright via `npm run test:e2e`). */
export const DESKTOP_DIR = path.join(REPO_ROOT, "desktop");

/** Pasta server/ (para `uv run python -m app.run`). */
export const SERVER_DIR = path.join(REPO_ROOT, "server");
