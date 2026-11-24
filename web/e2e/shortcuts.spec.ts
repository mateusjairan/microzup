/**
 * Spec 6 (§10/§14): ATALHOS DE TECLADO.
 *
 * Ctrl+K (palette com grupos), Ctrl+N, Alt+↑/↓ (troca de conversa),
 * Ctrl+Shift+A (zera não lidas), Ctrl+, (settings abre; Esc fecha) e Esc
 * fecha overlays. Ctrl+Shift+L bloqueia a sessão e a reautenticação
 * PRESERVA o rascunho do composer (§9).
 *
 * Um único app + login para os seis casos (login tem rate limit de 10/min
 * por IP no servidor — cada janela nova é um login a mais).
 *
 * Ctrl+O (anexar) abre o seletor nativo de arquivos do Windows, um modal de
 * SO que o Playwright não dirige sem alterar o app — o fluxo de anexo é
 * coberto pelo upload.spec via setInputFiles; documentado no relatório.
 */
import { expect, test } from "@playwright/test";

import { ALICE, BRUNO, CHANNEL_NAME } from "./constants";
import { apiLogin, apiToken, findConversation, openDm, sendMessageAs } from "./api";
import {
  KEY,
  closeApp,
  composer,
  contactRow,
  launchApp,
  openConversation,
  type AppSession,
} from "./app";

let session: AppSession | null = null;

test.describe("atalhos globais (§10)", () => {
  test.beforeAll(async () => {
    // DM alice↔bruno para Alt+↑/↓; app único + login único.
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const bruno = await apiLogin(BRUNO.username, BRUNO.password);
    await openDm(aliceToken, bruno.user.id);

    session = await launchApp({ loginAs: ALICE });
    await openConversation(session.page, CHANNEL_NAME);
  });

  test.afterAll(async () => {
    if (session !== null) {
      await closeApp(session.app);
      session = null;
    }
  });

  test("Ctrl+K abre palette com grupos (Conversas/Pessoas/Mensagens); Enter abre; Esc fecha", async () => {
    const page = session!.page;
    await openConversation(page, CHANNEL_NAME);

    // Termo buscável semeado via REST: o grupo Mensagens depende de conteúdo.
    const needle = `agulha-busca-${Date.now()}`;
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, needle);

    await page.keyboard.press(KEY.ctrlK);
    const paletteInput = page.getByPlaceholder("Buscar pessoas, setores, mensagens…");
    await expect(paletteInput).toBeVisible();

    // Grupos locais (filtro instantâneo, sem rede): query curta casa
    // o canal ("E2E Qualidade") e as pessoas com "e" no nome.
    await paletteInput.fill("e");
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByText("Conversas", { exact: true })).toBeVisible();
    await expect(listbox.getByText("Pessoas", { exact: true })).toBeVisible();

    // Grupo Mensagens: busca remota com termo semeado (envelope SearchOut
    // {messages, files} — reconciliado entre backend e SearchHost).
    await paletteInput.fill(needle);
    await expect(listbox.getByText("Mensagens", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(listbox.getByText(new RegExp(needle))).toBeVisible();

    // Enter abre a conversa NA POSIÇÃO da mensagem (§8.7, destaque 2 s).
    await paletteInput.press("Enter");
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole("feed").getByText(needle, { exact: true })).toBeVisible();

    // Esc fecha overlays: reabre e fecha.
    await page.keyboard.press(KEY.ctrlK);
    await expect(paletteInput).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(paletteInput).toBeHidden();
  });

  test("Ctrl+F busca dentro da conversa ativa (grupo 'nesta conversa')", async () => {
    const page = session!.page;
    await openConversation(page, CHANNEL_NAME);

    const needle = `agulha-ctrlf-${Date.now()}`;
    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, needle);

    await page.keyboard.press(KEY.ctrlF);
    const paletteInput = page.getByPlaceholder("Buscar pessoas, setores, mensagens…");
    await expect(paletteInput).toBeVisible();

    await paletteInput.fill(needle);
    const listbox = page.getByRole("listbox");
    await expect(listbox.getByText("Mensagens nesta conversa", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(listbox.getByText(new RegExp(needle))).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(paletteInput).toBeHidden();
  });

  test("Ctrl+N abre palette no modo nova conversa (pessoas primeiro)", async () => {
    const page = session!.page;
    await openConversation(page, CHANNEL_NAME);

    await page.keyboard.press(KEY.ctrlN);
    await expect(page.getByPlaceholder("Buscar pessoas, setores, mensagens…")).toBeVisible();
    // Com query vazia o grupo Pessoas aparece (preferredGroup) com os colegas.
    await expect(page.getByRole("listbox").getByText("Pessoas", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder("Buscar pessoas, setores, mensagens…")).toBeHidden();
  });

  test("Alt+↑/↓ alterna entre conversas (canal ↔ DM)", async () => {
    const page = session!.page;
    await openConversation(page, CHANNEL_NAME);

    const channelRow = contactRow(page, "Setores", "E2E Qualidade");
    const dmRow = contactRow(page, "Conversas", "Bruno Lima (E2E)");

    await expect(channelRow.first()).toHaveAttribute("aria-current", "true");

    await page.keyboard.press(KEY.altDown);
    await expect(dmRow.first()).toHaveAttribute("aria-current", "true");
    await expect(channelRow.first()).not.toHaveAttribute("aria-current", "true");

    await page.keyboard.press(KEY.altUp);
    await expect(channelRow.first()).toHaveAttribute("aria-current", "true");
  });

  test("Ctrl+Shift+A zera as não lidas do canal", async () => {
    const page = session!.page;

    // Alice focada na DM: mensagens no canal viram não lidas com badge.
    await openConversation(page, "Bruno Lima (E2E)", "Conversas");
    await expect(contactRow(page, "Conversas", "Bruno Lima (E2E)")).toHaveAttribute(
      "aria-current",
      "true",
    );

    const aliceToken = await apiToken(ALICE.username, ALICE.password);
    const conversation = await findConversation(aliceToken, { channelName: CHANNEL_NAME });
    await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, `nao-lida-1-${Date.now()}`);
    await sendMessageAs(BRUNO.username, BRUNO.password, conversation.conversation.id, `nao-lida-2-${Date.now()}`);

    // O badge vive na DIV da linha (irmã do botão interno).
    const channelRowDiv = contactRow(page, "Setores", "E2E Qualidade")
      .first()
      .locator("xpath=ancestor::div[1]");
    await expect(channelRowDiv.getByText("2", { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press(KEY.ctrlShiftA);
    await expect(channelRowDiv.getByText("2", { exact: true })).toBeHidden({ timeout: 20_000 });
  });

  test("Ctrl+, abre settings; Esc fecha", async () => {
    const page = session!.page;
    await openConversation(page, CHANNEL_NAME);

    await page.keyboard.press(KEY.ctrlComma);
    await expect(page.getByText("Configurações")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tema claro" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByText("Configurações")).toBeHidden();
  });

  /**
   * O bloqueio de sessão é 100% do renderer (store + ReauthOverlay); não
   * depende de shell nativo nem de IPC.
   */
  test("Ctrl+Shift+L bloqueia a sessão; reautenticação preserva o rascunho", async () => {
    const page = session!.page;
    await openConversation(page, CHANNEL_NAME);
    const draft = `rascunho-preservado-${Date.now()}`;
    await composer(page).fill(draft);

    await page.keyboard.press(KEY.ctrlShiftL);
    await expect(page.getByText("Sessão bloqueada")).toBeVisible();
    await expect(page.locator("#reauth-password")).toBeVisible();

    // Senha errada primeiro (erro do overlay), depois a correta.
    await page.locator("#reauth-password").fill("senha-errada");
    await page.getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByText("Senha incorreta.", { exact: true })).toBeVisible();

    await page.locator("#reauth-password").fill(ALICE.password);
    await page.getByRole("button", { name: "Desbloquear" }).click();
    await expect(page.getByText("Sessão bloqueada")).toBeHidden({ timeout: 20_000 });

    // Nada foi perdido (§9): o rascunho continua no composer.
    await expect(composer(page)).toHaveValue(draft);
  });
});
