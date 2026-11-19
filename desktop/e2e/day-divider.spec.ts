/**
 * Regressão de UI (§7): "Hoje" repetido entre mensagens do mesmo dia.
 *
 * Três mensagens no mesmo dia precisam produzir UM divisor "Hoje" — antes da
 * correção o `itemContent` indexava as flags pelo índice absoluto do Virtuoso
 * (`firstItemIndex` = 100.000), caía no fallback e desenhava um divisor por
 * mensagem.
 */
import { expect, test } from "@playwright/test";

import { ALICE, CHANNEL_NAME } from "./constants";
import { closeApp, feedMessage, launchApp, openConversation, sendViaComposer, type AppSession } from "./app";

test.describe("divisor de dia na lista de mensagens", () => {
  let session: AppSession | null = null;

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("três mensagens do mesmo dia → exatamente um divisor 'Hoje'", async ({}, testInfo) => {
    test.setTimeout(180_000);
    session = await launchApp({ loginAs: ALICE });
    const page = session.page;
    await openConversation(page, CHANNEL_NAME);

    const stamp = Date.now();
    const bodies = [`dia-1-${stamp}`, `dia-2-${stamp}`, `dia-3-${stamp}`];
    for (const body of bodies) {
      await sendViaComposer(page, body);
      await expect(feedMessage(page, body)).toBeVisible({ timeout: 20_000 });
    }

    // Todas no mesmo dia (o teste roda em sequência imediata): um único "Hoje".
    const todayDividers = page.getByRole("separator", { name: "Hoje" });
    await expect(todayDividers).toHaveCount(1);

    // Sanidade: o divisor de dia é único mesmo com as três bolhas na tela.
    for (const body of bodies) {
      await expect(feedMessage(page, body)).toBeVisible();
    }
    testInfo.annotations.push({ type: "resultado", description: "um divisor por dia" });
  });
});
