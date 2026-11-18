/**
 * Spec 2 (§8.1/§14): ENVIO OTIMISTA + FALHA + RETRY.
 *
 * Envia uma mensagem com o servidor NO AR (bolha sending→sent para o caminho
 * feliz ser provado), depois MATA o backend, envia outra mensagem — a bolha
 * fica "failed" com botão "Reenviar" — religa o servidor, clica em Reenviar e
 * confirma pelo histórico REST que a mensagem existe EXATAMENTE uma vez
 * (idempotência por client_id: um novo client_id teria criado duplicata).
 *
 * Obs.: ao reconectar, o app reenvia a fila sozinho (flushOutbox no catch-up);
 * o clique em "Reenviar" acontece logo após o /health voltar — se o flush
 * automático ganhar a corrida, o estado final é idêntico (sent, sem duplicata)
 * e o teste aceita os dois caminhos válidos.
 */
import { expect, test } from "@playwright/test";

import { ALICE, BRUNO, CHANNEL_NAME } from "./constants";
import { findConversation, listMessages, apiToken, sendMessageAs } from "./api";
import { restartBackend, stopBackend } from "./backend";
import { closeApp, composer, feedMessage, launchApp, openConversation, reconnectBanner, sendViaComposer, type AppSession } from "./app";

test.describe("envio otimista — falha e retry idempotente", () => {
  let session: AppSession | null = null;

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("sending→failed com 'Reenviar'; retry religa o servidor e não duplica", async ({ }, testInfo) => {
    test.setTimeout(240_000);
    const unique = testInfo.retry ? `retry-${testInfo.retry}` : "retry";
    const happyBody = `otimista-happy-${unique}-${Date.now()}`;
    const failedBody = `otimista-falha-${unique}-${Date.now()}`;

    session = await launchApp({ loginAs: ALICE });
    const page = session.page;
    await openConversation(page, CHANNEL_NAME);

    // --- caminho feliz: servidor no ar --------------------------------
    await sendViaComposer(page, happyBody);
    await expect(feedMessage(page, happyBody)).toBeVisible();
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });

    // --- derruba o servidor -------------------------------------------
    await stopBackend();
    await expect(reconnectBanner(page)).toBeVisible({ timeout: 20_000 });

    // --- envio com servidor morto: bolha failed + "Reenviar" ----------
    await composer(page).fill(failedBody);
    await composer(page).press("Enter");
    await expect(feedMessage(page, failedBody)).toBeVisible();
    await expect(page.getByText("Falha no envio")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reenviar" })).toBeVisible();
    // O composer continua ativo com a fila pendente (§9 "sem conexão").
    await expect(composer(page)).toBeEnabled();

    // --- religa e reenvia (mesmo client_id) ----------------------------
    await restartBackend();

    // O app reenvia a fila ao reconectar; se o banner sumir antes do clique,
    // o flush automático já cobriu o retry — ambos são comportamento válido.
    const resend = page.getByRole("button", { name: "Reenviar" });
    await resend.click({ timeout: 8_000 }).catch(() => undefined);

    await expect(page.getByText("Falha no envio")).toBeHidden({ timeout: 30_000 });
    await expect(reconnectBanner(page)).toBeHidden({ timeout: 30_000 });
    await expect(page.locator("aside").getByText("Conectado", { exact: true })).toBeVisible();

    // --- sem duplicata: exatamente UMA bolha no feed --------------------
    await expect(feedMessage(page, failedBody)).toHaveCount(1);

    // --- e o histórico REST confirma (mesmo client_id) ------------------
    const history = await listMessages(aliceToken, conversation.conversation.id);
    const copies = history.filter((message) => message.body === failedBody);
    expect(copies, "histórico deve ter exatamente 1 mensagem com esse corpo").toHaveLength(1);
    expect(copies[0].seq, "mensagem confirmada pelo servidor tem seq > 0").toBeGreaterThan(0);
    testInfo.annotations.push({ type: "client_id", description: copies[0].client_id });

    // A mensagem do caminho feliz também segue única.
    expect(history.filter((message) => message.body === happyBody)).toHaveLength(1);

    // --- fluxo em tempo real volta a funcionar ---------------------------
    const liveBody = `otimista-apos-retry-${Date.now()}`;
    await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, liveBody);
    await expect(feedMessage(page, liveBody)).toBeVisible({ timeout: 20_000 });
  });
});
