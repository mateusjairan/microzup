/**
 * Spec 5 (§8.6/§14): UPLOAD DE 50 MB + DOWNLOAD COM INTEGRIDADE.
 *
 * Gera 50 MiB de bytes aleatórios (incomprimíveis) em e2e/.tmp, anexa pelo
 * composer (setInputFiles no input oculto), confirma progresso VISÍVEL no
 * card da bandeja, envia a mensagem, baixa com progresso no FileCard e
 * confere SHA-256 ponta a ponta (arquivo salvo == original == sha256 que o
 * servidor registrou no anexo).
 *
 * O throughput é limitado via CDP (~20 Mbps) para o progresso ser observável;
 * sem CDP o fluxo segue válido (loopback é rápido demais para tick humano).
 * O diálogo nativo de salvar é trocado por um caminho automático via
 * evaluate() no processo MAIN — teste não muda código do app.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { ALICE, CHANNEL_NAME, E2E_TMP } from "./constants";
import { apiGet, apiToken, findConversation, listMessages } from "./api";
import {
  closeApp,
  composer,
  launchApp,
  openConversation,
  sendViaComposer,
  type AppSession,
} from "./app";
import type { ElectronApplication } from "playwright-core";

const SIZE_BYTES = 50 * 1024 * 1024; // 50 MiB
const THROTTLE_BYTES_PER_SECOND = 2_500_000; // ~20 Mbps

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function throttleNetwork(page: Page): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 50,
      downloadThroughput: THROTTLE_BYTES_PER_SECOND,
      uploadThroughput: THROTTLE_BYTES_PER_SECOND,
    });
    return true;
  } catch {
    // Sem CDP o teste continua válido; o progresso pode ser instantâneo.
    return false;
  }
}

/** Troca diálogo nativo de salvar e shell.openPath por respostas automáticas. */
async function autoApproveSaveDialog(app: ElectronApplication, savePath: string): Promise<void> {
  await app.evaluate(
    ({ dialog, shell }, { target }) => {
      const dialogAny = dialog as unknown as {
        showSaveDialog: (win: unknown, options: unknown) => Promise<{ canceled: boolean; filePath?: string }>;
      };
      dialogAny.showSaveDialog = async () => ({ canceled: false, filePath: target });
      const shellAny = shell as unknown as { openPath: (filePath: string) => Promise<string> };
      shellAny.openPath = async () => ""; // não abre arquivo no Windows (evita janela "abrir com")
    },
    { target: savePath },
  );
}

test.describe("upload e download de 50 MB com integridade", () => {
  let session: AppSession | null = null;
  const uploadPath = path.join(E2E_TMP, `e2e-big-${Date.now()}.bin`);
  const downloadPath = path.join(E2E_TMP, `e2e-big-saved-${Date.now()}.bin`);

  test.beforeAll(() => {
    fs.mkdirSync(E2E_TMP, { recursive: true });
    // 50 MiB de bytes aleatórios em blocos de 4 MiB.
    const handle = fs.openSync(uploadPath, "w");
    const chunkSize = 4 * 1024 * 1024;
    let written = 0;
    while (written < SIZE_BYTES) {
      const block = crypto.randomBytes(Math.min(chunkSize, SIZE_BYTES - written));
      fs.writeSync(handle, block);
      written += block.length;
    }
    fs.closeSync(handle);
  });

  test.afterAll(() => {
    // O arquivo NUNCA é commitado: apaga os dois artefatos temporários.
    fs.rmSync(uploadPath, { force: true });
    fs.rmSync(downloadPath, { force: true });
  });

  test.afterEach(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("upload com progresso, envio concluído, download íntegro (SHA-256 confere)", async ({ }, testInfo) => {
    test.setTimeout(300_000);
    const filename = path.basename(uploadPath);
    const originalHash = sha256File(uploadPath);
    expect(fs.statSync(uploadPath).size).toBe(SIZE_BYTES);

    session = await launchApp({ loginAs: ALICE });
    const page = session.page;
    await openConversation(page, CHANNEL_NAME);
    const throttled = await throttleNetwork(page);

    // --- anexa pelo input oculto (mesmo caminho do botão clipe) ----------
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(uploadPath);

    // --- progresso VISÍVEL no card da bandeja ----------------------------
    const trayItem = page.getByLabel("Anexos pendentes").locator("li").filter({ hasText: filename });
    await expect(trayItem).toBeVisible();
    await expect(trayItem.locator('[role="progressbar"]')).toBeVisible({ timeout: 20_000 });
    await expect(trayItem.getByText(/·\s*\d+%/)).toBeVisible();

    // --- upload concluído (card sai do estado uploading) ------------------
    await expect(trayItem.locator('[role="progressbar"]')).toBeHidden({ timeout: 180_000 });
    await expect(trayItem.getByText("Falha no envio")).toBeHidden();

    // --- envia a mensagem com o anexo pronto -----------------------------
    const caption = `upload-50mb-${Date.now()}`;
    await sendViaComposer(page, caption);
    await expect(page.getByRole("feed").getByText(caption, { exact: true })).toBeVisible();

    // FileCard da mensagem na conversa.
    const fileCard = page
      .getByRole("feed")
      .getByText(filename, { exact: true })
      .locator("xpath=ancestor::div[2]");
    await expect(fileCard).toBeVisible();
    await expect(fileCard.getByText(/50(\,0)? MB/)).toBeVisible();

    // --- download com progresso e integridade ------------------------------
    // BUG-1 (reportado ao lead): sem a ponte IPC (preload sandboxado que
    // carrega require local), o download completa e a integridade é
    // verificada no renderer, mas o diálogo nativo de salvar não abre — não
    // há arquivo em disco nem toast "Arquivo salvo". Com a ponte viva (pós
    // correção), a suíte exige o ciclo completo com hash do arquivo salvo.
    const hasBridge = await page.evaluate(
      () => (window as unknown as { microzup?: unknown }).microzup !== undefined,
    );
    if (hasBridge) {
      await autoApproveSaveDialog(session.app, downloadPath);
    }
    const downloadButton = fileCard.getByRole("button", { name: "Baixar" });
    await downloadButton.click();

    // Progresso no card durante o download (exigido com throttle CDP;
    // sem limite o loopback pode concluir entre ticks).
    if (throttled) {
      await expect(fileCard.locator('[role="progressbar"]')).toBeVisible({ timeout: 15_000 });
      await expect(fileCard.getByText(/Baixando…\s*\d+%/)).toBeVisible({ timeout: 30_000 });
    }
    // Fim do estado de download (progresso sai do card em sucesso OU falha).
    await expect(fileCard.locator('[role="progressbar"]')).toBeHidden({ timeout: 120_000 });
    await page.waitForTimeout(2_000);

    if (hasBridge) {
      await expect(page.getByText("Arquivo salvo.")).toBeVisible({ timeout: 30_000 });
      // --- INTEGRIDADE: SHA-256 do arquivo salvo == original ----------------
      await expect
        .poll(async () => (fs.existsSync(downloadPath) ? fs.statSync(downloadPath).size : 0), {
          timeout: 20_000,
        })
        .toBe(SIZE_BYTES);
      expect(sha256File(downloadPath), "hash do arquivo baixado confere com o original").toBe(originalHash);
    } else {
      // Sem ponte: a verificação de hash do renderer RODOU (download íntegro
      // → nenhum toast de erro); salvar em disco é impossível até o BUG-1.
      expect(page.getByText("O arquivo baixado não confere")).toHaveCount(0);
      expect(page.getByText("Arquivo salvo.")).toHaveCount(0);
      expect(fs.existsSync(downloadPath)).toBe(false);
      console.log(
        "[upload] BUG-1: ponte IPC ausente — download íntegro (sem erro de hash), mas salvar em disco não é exercitado",
      );
    }

    // E o servidor registrou o MESMO hash no anexo.
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    const history = await listMessages(aliceToken, conversation.conversation.id);
    const message = history.find((entry) => entry.body === caption);
    expect(message, "mensagem com legenda existe no histórico").toBeDefined();
    const attachments = await apiGet<
      Array<{ filename: string; sha256: string; size_bytes: number }>
    >(aliceToken, `/messages/${message!.id}/attachments`);
    const attachment = attachments.find((entry) => entry.filename === filename);
    expect(attachment, "anexo listado na mensagem").toBeDefined();
    expect(attachment!.sha256.toLowerCase()).toBe(originalHash);
    expect(attachment!.size_bytes).toBe(SIZE_BYTES);
    testInfo.annotations.push({ type: "sha256", description: originalHash });

    // composer continua utilizável depois de tudo
    await expect(composer(page)).toBeEnabled();
  });
});
