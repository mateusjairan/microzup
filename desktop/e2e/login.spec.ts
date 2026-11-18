/**
 * Spec 1 (§14): LOGIN.
 *  - primeira execução pede o endereço do servidor (campo obrigatório);
 *  - login válido entra no shell (sidebar + WS "Conectado");
 *  - login inválido mostra o erro do envelope do servidor;
 *  - servidor inacessível mostra o erro de conexão (§5).
 */
import { expect, test } from "@playwright/test";

import { ALICE, BASE_URL } from "./constants";
import { launchApp, closeApp, contactRow, sidebarGroup, type AppSession } from "./app";

test.describe("login / primeira execução", () => {
  let session: AppSession | null = null;

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("primeira execução pede servidor; teste de conexão bate em /health", async () => {
    session = await launchApp();

    await expect(session.page.locator("#login-server")).toBeVisible();
    await expect(session.page.locator("#login-username")).toBeVisible();
    await expect(session.page.locator("#login-password")).toBeVisible();
    await expect(
      session.page.getByText("Manter conectado neste computador"),
    ).toBeVisible();
    await expect(session.page.getByRole("button", { name: "Testar conexão" })).toBeVisible();

    await session.page.locator("#login-server").fill(BASE_URL);
    await session.page.getByRole("button", { name: "Testar conexão" }).click();
    await expect(session.page.getByText("Servidor acessível")).toBeVisible();
  });

  test("servidor vazio é bloqueado antes de tentar conectar", async () => {
    session = await launchApp();

    await session.page.locator("#login-server").fill("");
    await session.page.locator("#login-username").fill(ALICE.username);
    await session.page.locator("#login-password").fill(ALICE.password);
    await session.page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(session.page.getByRole("alert")).toHaveText(
      "Informe o endereço do servidor",
    );
  });

  test("servidor inacessível mostra erro de conexão (sem tocar no backend real)", async () => {
    session = await launchApp();

    // Porta vizinha que permanece livre durante toda a suíte.
    await session.page.locator("#login-server").fill("http://127.0.0.1:8669");
    await session.page.locator("#login-username").fill(ALICE.username);
    await session.page.locator("#login-password").fill(ALICE.password);
    await session.page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(session.page.getByRole("alert")).toHaveText(
      "Não foi possível conectar ao servidor",
    );
  });

  test("credencial inválida mostra o erro do envelope (401 authentication_error)", async () => {
    session = await launchApp();

    await session.page.locator("#login-server").fill(BASE_URL);
    await session.page.locator("#login-username").fill(ALICE.username);
    await session.page.locator("#login-password").fill("senha-errada-nao-e-a-fixture");
    await session.page.getByRole("button", { name: "Entrar", exact: true }).click();

    // Exatamente uma tentativa inválida: o bloqueio progressivo começa em 5.
    await expect(session.page.getByRole("alert")).toHaveText("Usuário ou senha inválidos");
  });

  test("login válido entra no shell com canal do setor e WS online", async () => {
    session = await launchApp();

    await session.page.locator("#login-server").fill(BASE_URL);
    await session.page.locator("#login-username").fill(ALICE.username);
    await session.page.locator("#login-password").fill(ALICE.password);
    await session.page.getByRole("button", { name: "Entrar", exact: true }).click();

    const page = session.page;
    await expect(page.locator("aside").getByText("Conectado", { exact: true })).toBeVisible();
    await expect(
      page.locator("aside").getByRole("button", { name: /Buscar pessoas/ }),
    ).toBeVisible();
    await expect(contactRow(page, "Setores", "E2E Qualidade")).toBeVisible();
    await expect(sidebarGroup(page, "Setores")).toBeVisible();
    await expect(sidebarGroup(page, "Equipe")).toBeVisible();
  });
});
