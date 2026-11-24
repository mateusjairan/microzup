/**
 * Spec 4 (§9/§14): RECONEXÃO + CATCH-UP POR after_seq.
 *
 * Derruba o servidor; o cliente entra no loop "reconectando (n/∞)". Espera o
 * backoff subir (tentativa ≥5 → próximo tick = 15 s) para abrir uma janela
 * larga, RELIGA o servidor e dispara 3 mensagens via REST (bruno) ANTES do
 * próximo tick do WS — as mensagens caem na lacuna e chegam ao cliente pelo
 * catch-up (GET /messages?after_seq), não por push.
 *
 * Falha explícita se: banner não aparecer, mensagens duplicarem ou sumirem.
 */
import { expect, test } from "@playwright/test";

import { ALICE, BRUNO, CHANNEL_NAME } from "./constants";
import { apiToken, findConversation, listMessages, sendMessageAs } from "./api";
import { restartBackend, stopBackend } from "./backend";
import {
  closeApp,
  feedMessage,
  launchApp,
  openConversation,
  reconnectBanner,
  type AppSession,
} from "./app";

test.describe("reconexão com catch-up por seq", () => {
  let session: AppSession | null = null;

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("banner n/∞ durante queda; mensagens da lacuna aparecem após reconexão sem duplicar", async ({ }, testInfo) => {
    test.setTimeout(240_000);

    // Tokens REST ANTES da queda (access token vale 15 min).
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    const before = await listMessages(aliceToken, conversation.conversation.id);
    const baselineSeq = before.length > 0 ? before[before.length - 1].seq : 0;

    session = await launchApp({ loginAs: ALICE });
    const page = session.page;
    await openConversation(page, CHANNEL_NAME);

    // --- derruba: banner "Reconectando (n/∞)" --------------------------
    await stopBackend();
    const banner = reconnectBanner(page);
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText(/Reconectando \(\d+\/∞\)/);

    // Deixa o backoff subir (1+2+4+8 = 15 s de quedas) para a janela do
    // restart ficar larga (próximo tick em 15 s).
    await expect
      .poll(async () => {
        const text = await banner.innerText().catch(() => "");
        const match = text.match(/Reconectando \((\d+)\/∞\)/);
        return match === null ? 0 : Number(match[1]);
      }, { timeout: 40_000 })
    .toBeGreaterThanOrEqual(5);

    // --- religa e semeia a lacuna IMEDIATAMENTE (via REST/bruno) --------
    await restartBackend();
    const stamp = Date.now();
    const gapBodies = [`catchup-1-${stamp}`, `catchup-2-${stamp}`, `catchup-3-${stamp}`];
    for (const body of gapBodies) {
      await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, body);
    }

    // --- banner some; mensagens aparecem (catch-up after_seq) -----------
    await expect(banner).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("aside").getByText("Conectado", { exact: true })).toBeVisible();
    for (const body of gapBodies) {
      await expect(feedMessage(page, body)).toBeVisible({ timeout: 20_000 });
    }

    // --- sem duplicar no feed e sem perder no histórico ----------------
    for (const body of gapBodies) {
      expect(await feedMessage(page, body).count(), `uma única bolha para "${body}"`).toBe(1);
    }
    // "Nada se perdeu": catch-up completo após a linha de base do teste.
    // (Comparar comprimentos de página não funciona quando a conversa
    // ultrapassa o teto de 200 do endpoint — after_seq lista TUDO após a
    // linha de base.)
    const catchUp = await listMessages(aliceToken, conversation.conversation.id, {
      afterSeq: baselineSeq,
    });
    for (const body of gapBodies) {
      const copies = catchUp.filter((message) => message.body === body);
      expect(copies, `histórico pós-baseline com uma única cópia de "${body}"`).toHaveLength(1);
      expect(copies[0].seq, "seq canônica no servidor").toBeGreaterThan(baselineSeq);
    }
    expect(catchUp.length, "nada se perdeu após a baseline").toBeGreaterThanOrEqual(gapBodies.length);
    testInfo.annotations.push({ type: "baseline_seq", description: String(baselineSeq) });
  });
});
