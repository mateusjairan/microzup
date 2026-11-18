/**
 * Spec 7 (§8.3/§14): PRESENÇA E DIGITAÇÃO entre DOIS usuários reais.
 *
 * Duas instâncias do Electron com userData separado (lock por user-data-dir):
 * bruno na janela B, alice na janela A.
 *  - bruno muda o status para "Ocupado" → alice vê o texto na sidebar (Equipe);
 *  - bruno digita no canal (sem enviar) → alice vê "está digitando…";
 *  - bruno envia → alice recebe ao vivo (message.created).
 */
import { expect, test } from "@playwright/test";

import { ALICE, BRUNO, CHANNEL_NAME } from "./constants";
import { closeApp, composer, launchApp, openConversation, type AppSession } from "./app";

test.describe("presença e typing entre dois usuários", () => {
  let aliceApp: AppSession | null = null;
  let brunoApp: AppSession | null = null;

  test.afterEach(async () => {
    if (brunoApp !== null) {
      await closeApp(brunoApp.app);
      brunoApp = null;
    }
    if (aliceApp !== null) {
      await closeApp(aliceApp.app);
      aliceApp = null;
    }
  });

  test("status muda na sidebar do outro; 'digitando' aparece; mensagem chega ao vivo", async () => {
    test.setTimeout(180_000);

    // --- janela B: bruno conecta primeiro --------------------------------
    brunoApp = await launchApp({ loginAs: BRUNO });
    const brunoPage = brunoApp.page;
    await openConversation(brunoPage, CHANNEL_NAME);

    // --- janela A: alice --------------------------------------------------
    aliceApp = await launchApp({ loginAs: ALICE });
    const alicePage = aliceApp.page;
    await openConversation(alicePage, CHANNEL_NAME);

    // --- bruno muda o status → presence.changed para todos ---------------
    // (gatilho é button desde a correção de aria-allowed-attr)
    await brunoPage.locator("header button[aria-haspopup]").first().click();
    // Nome acessível da opção é "Ocupado Ocupado" (dot com aria-label + texto).
    await brunoPage
      .locator('[data-state="open"]')
      .getByRole("button", { name: /Ocupado/ })
      .click();

    // Alice vê "Ocupado" na linha do bruno (Equipe) — presença nunca só cor.
    await expect(
      alicePage.locator("aside").getByText("Ocupado", { exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // --- bruno digita sem enviar → typing --------------------------------
    await composer(brunoPage).fill("bruno está digitando algo…");

    await expect(
      alicePage.getByText("Bruno Lima (E2E) está digitando…"),
    ).toBeVisible({ timeout: 8_000 });

    // --- bruno envia → alice recebe ao vivo -------------------------------
    const liveBody = `presenca-ao-vivo-${Date.now()}`;
    await composer(brunoPage).fill(liveBody);
    await composer(brunoPage).press("Enter");

    await expect(alicePage.getByRole("feed").getByText(liveBody, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // O indicador de typing desaparece com a mensagem (§8.1).
    await expect(alicePage.getByText("Bruno Lima (E2E) está digitando…")).toBeHidden({
      timeout: 10_000,
    });
  });
});
