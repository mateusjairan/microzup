/**
 * Spec 1 (§14): LOGIN no cliente web.
 *  - a tela de login não pede servidor: a página já é servida pelo backend;
 *  - login inválido mostra o erro do envelope do servidor;
 *  - login válido entra no shell (sidebar + WS "Conectado");
 *  - a sessão sobrevive a um reload via cookie HttpOnly, sem token no JS.
 */
import { expect, test } from "@playwright/test";

import { ALICE } from "./constants";
import { launchApp, closeApp, contactRow, sidebarGroup, type AppSession } from "./app";

test.describe("login", () => {
  let session: AppSession | null = null;

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("login pede apenas credenciais (servidor vem da própria origem)", async () => {
    session = await launchApp();

    await expect(session.page.locator("#login-username")).toBeVisible();
    await expect(session.page.locator("#login-password")).toBeVisible();
    await expect(
      session.page.getByText("Manter conectado neste computador"),
    ).toBeVisible();
    await expect(session.page.locator("#login-server")).toHaveCount(0);
  });

  test("credencial inválida mostra o erro do envelope (401 authentication_error)", async () => {
    session = await launchApp();

    await session.page.locator("#login-username").fill(ALICE.username);
    await session.page.locator("#login-password").fill("senha-errada-nao-e-a-fixture");
    await session.page.getByRole("button", { name: "Entrar", exact: true }).click();

    // Exatamente uma tentativa inválida: o bloqueio progressivo começa em 5.
    await expect(session.page.getByRole("alert")).toHaveText("Usuário ou senha inválidos");
  });

  test("login válido entra no shell com canal do setor e WS online", async () => {
    session = await launchApp();

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

  test("reload mantém a sessão; refresh token não é visível ao JavaScript", async () => {
    session = await launchApp({ loginAs: ALICE });
    const page = session.page;
    await expect(page.locator("aside").getByText("Conectado", { exact: true })).toBeVisible();

    // O cookie de refresh é HttpOnly: não aparece em document.cookie.
    const visibleCookies = await page.evaluate(() => document.cookie);
    expect(visibleCookies).not.toContain("mz_refresh");

    await page.reload();
    await expect(page.locator("aside").getByText("Conectado", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("#login-username")).toHaveCount(0);
  });
});
