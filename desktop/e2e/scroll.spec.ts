/**
 * Spec 3 (§8.2/§14): SCROLL COM NOVAS MENSAGENS.
 *
 * Histórico semeado via REST (20 do bruno + 20 da alice — cada um abaixo do
 * rate limit de 30/min por usuário) para a conversa rolar.
 *
 *  - no fim (<120 px): nova mensagem do bruno mantém o scroll COLADO;
 *  - fora do fim (>120 px): 2 novas mensagens → pill "2 novas mensagens",
 *    scroll não puxa; clicar na pill pula para o fim e some.
 */
import { expect, test } from "@playwright/test";

import { ALICE, BRUNO, CHANNEL_NAME } from "./constants";
import { apiToken, findConversation, listMessages, markRead, sendMessageAs } from "./api";
import {
  closeApp,
  distanceFromBottom,
  feedMessage,
  launchApp,
  openConversation,
  type AppSession,
} from "./app";

test.describe("scroll: stick no fim e pill fora do fim", () => {
  let session: AppSession | null = null;

  test.beforeAll(async () => {
    // Semeia 40 mensagens (20 por usuário — respeita 30/min por usuário) e
    // normaliza o estado de leitura da alice: a conversa abre NO FIM (§8.2),
    // deixando o caso "stick" determinístico.
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    const stamp = Date.now();
    for (let index = 0; index < 20; index += 1) {
      await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, `seed-b-${stamp}-${index}`);
      await sendMessageAs(ALICE.username, ALICE.password, conversation.conversation.id, `seed-a-${stamp}-${index}`);
    }
    const history = await listMessages(aliceToken, conversation.conversation.id);
    const lastSeq = history.length > 0 ? history[history.length - 1].seq : 0;
    await markRead(aliceToken, conversation.conversation.id, lastSeq);
  });

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("no fim: nova mensagem mantém o stick; fora do fim: pill sem puxar o scroll", async ({ }, testInfo) => {
    test.setTimeout(180_000);
    session = await launchApp({ loginAs: ALICE });
    const page = session.page;
    await openConversation(page, CHANNEL_NAME);

    // Abertura posiciona no fim (sem não-lidas a mais).
    await expect
      .poll(async () => distanceFromBottom(page), { timeout: 20_000 })
      .toBeLessThan(120);

    // --- caso A: colado no fim → stick --------------------------------
    const stickBody = `scroll-stick-${Date.now()}`;
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, stickBody);

    await expect(feedMessage(page, stickBody)).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => distanceFromBottom(page), { timeout: 10_000 })
      .toBeLessThan(120);

    // --- caso B: fora do fim → pill "N novas mensagens" -----------------
    // Mouse sobre o SCROLLER (fixado na janela) — o feed semântico é a lista
    // virtualizada completa, com bounding box que se estende acima da janela.
    const scroller = page.locator('[data-test-id="virtuoso-scroller"]');
    const scrollerBox = await scroller.boundingBox();
    if (scrollerBox === null) throw new Error("E2E: scroller sem bounding box");
    await page.mouse.move(
      scrollerBox.x + scrollerBox.width / 2,
      scrollerBox.y + Math.min(scrollerBox.height / 2, 300),
    );

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.mouse.wheel(0, -600);
      const distance = await distanceFromBottom(page);
      if (distance > 200 && Number.isFinite(distance)) break;
      await page.waitForTimeout(200);
    }
    await expect
      .poll(async () => distanceFromBottom(page))
      .toBeGreaterThan(120);

    const pillBodies = [`scroll-pill-1-${Date.now()}`, `scroll-pill-2-${Date.now()}`];
    for (const body of pillBodies) {
      await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, body);
    }

    const pill = page.getByRole("button", { name: /2 novas mensagens/ });
    await expect(pill).toBeVisible({ timeout: 20_000 });

    // O scroll NÃO puxou: as mensagens novas continuam fora da janela e a
    // distância do fim permanece >120. (scrollTop absoluto pode variar
    // legitimamente quando FileCards renderizam e a virtualização recalcula
    // alturas acima — o requisito §8.2 é visual, não métrico.)
    await expect
      .poll(async () => distanceFromBottom(page))
      .toBeGreaterThan(120);
    for (const body of pillBodies) {
      await expect(feedMessage(page, body)).not.toBeVisible();
    }

    // Clicar na pill pula para o fim e some.
    await pill.click();
    await expect(pill).toBeHidden();
    await expect
      .poll(async () => distanceFromBottom(page), { timeout: 10_000 })
      .toBeLessThan(120);
    for (const body of pillBodies) {
      await expect(feedMessage(page, body)).toBeVisible();
    }
    testInfo.annotations.push({ type: "resultado", description: "stick + pill ok" });
  });
});
