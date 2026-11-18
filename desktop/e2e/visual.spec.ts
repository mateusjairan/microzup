/**
 * Spec (§14): BASELINE VISUAL para regressão.
 *
 * Screenshots em 1024×680, 1280×800 e 1440×900, tema claro E escuro, nas
 * telas principais: login, shell com conversa, palette de busca, settings e
 * admin. O tamanho vem de setContentSize (janela frameless → conteúdo =
 * viewport). O tema escuro/claro é o modo manual do Settings (§6).
 *
 * Determinismo:
 *  - a conversa exibida é uma DM semead uma única vez com corpos FIXOS
 *    (idempotente por âncora) e normalizada como lida (sem divisor de não
 *    lidas, posição no fim);
 *  - máscaras para conteúdo dinâmico: <time> (timestamps), divisores de dia
 *    ("Hoje"/"Ontem" mudam com a data) e o preview da linha do canal (a
 *    conversa acumula mensagens das outras specs a cada rodada).
 *
 * Regenerar a baseline: `npx playwright test visual --update-snapshots`
 * (a suíte exige a baseline existir; primeira geração roda com a flag).
 * As telas espelham o banco de dev — após mudanças de dados, regenere.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

import { ADMIN, ALICE, BRUNO } from "./constants";
import { apiLogin, apiToken, listMessages, markRead, openDm, sendMessageAs } from "./api";
import {
  KEY,
  closeApp,
  composer,
  contactRow,
  launchApp,
  loginViaUi,
  setViewportSize,
} from "./app";

const SIZES = [
  { width: 1024, height: 680 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const DM_ANCHOR = "Bom dia — auditoria da linha 2 às 14h";
const DM_SEED: Array<{ as: typeof BRUNO | typeof ALICE; body: string }> = [
  { as: BRUNO, body: DM_ANCHOR },
  { as: ALICE, body: "Confirmado. Levo o checklist atualizado." },
  { as: BRUNO, body: "Segue o resumo do desvio 045 em anexo depois" },
  { as: BRUNO, body: "Recebido, vou conferir com o QA" },
  { as: ALICE, body: "Perfeito. Bom turno!" },
  { as: BRUNO, body: "Obrigado! Encerrando aqui." },
];

let dmSeeded = false;
let dmId = "";

async function seedDmOnce(): Promise<void> {
  if (dmSeeded) return;
  const aliceToken = await apiToken(ALICE.username, ALICE.password);
  const bruno = await apiLogin(BRUNO.username, BRUNO.password);
  const dm = await openDm(aliceToken, bruno.user.id);
  const history = await listMessages(aliceToken, dm.id);
  if (!history.some((message) => message.body === DM_ANCHOR)) {
    for (const seed of DM_SEED) {
      await sendMessageAs(seed.as.username, seed.as.password, dm.id, seed.body);
    }
  }
  dmId = dm.id;
  dmSeeded = true;
}

/** Normaliza o estado de leitura da alice na DM (sem divisor, no fim). */
async function normalizeDmReadState(): Promise<void> {
  const aliceToken = await apiToken(ALICE.username, ALICE.password);
  const history = await listMessages(aliceToken, dmId);
  const lastSeq = history.length > 0 ? history[history.length - 1].seq : 0;
  await markRead(aliceToken, dmId, lastSeq);
}

async function blurActive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active !== null && active instanceof HTMLElement) active.blur();
  });
}

function shot(page: Page, name: string, extraMasks: Locator[] = []): Promise<void> {
  return expect(page).toHaveScreenshot(`${name}.png`, {
    maxDiffPixelRatio: 0.02,
    mask: [
      page.locator("time"), // timestamps das bolhas
      page.getByRole("separator"), // divisores de dia ("Hoje" muda com a data)
      ...extraMasks,
    ],
  });
}

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`baseline visual ${tag}`, () => {
    test.beforeAll(async () => {
      await seedDmOnce();
      await normalizeDmReadState();
    });

    test(`login, conversa, palette e settings (${tag}, claro e escuro)`, async ({ }) => {
      test.setTimeout(240_000);
      const session = await launchApp();
      try {
        const page = session.page;
        await setViewportSize(session.app, size);

        // Login em tema escuro via prefers-color-scheme (fresh userData segue o SO).
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("#login-server")).toBeVisible();
        await blurActive(page);
        await shot(page, `login--${tag}--dark`);

        // Entra e abre a DM semeada.
        await loginViaUi(page, ALICE);
        await contactRow(page, "Conversas", "Bruno Lima (E2E)").first().click();
        await composer(page).waitFor({ state: "visible" });
        // Preview do canal muda a cada rodada (specs enviam mensagens lá).
        const channelRowText = contactRow(page, "Setores", "E2E Qualidade").locator("span.truncate");

        // Tema claro manual (Settings) — screenshots em claro.
        await page.keyboard.press(KEY.ctrlComma);
        await page.getByRole("button", { name: "Tema claro" }).click();
        await blurActive(page);
        await shot(page, `settings--${tag}--light`);
        await page.keyboard.press("Escape");

        await blurActive(page);
        await shot(page, `conversa--${tag}--light`, [channelRowText]);

        await page.keyboard.press(KEY.ctrlK);
        await expect(page.getByPlaceholder("Buscar pessoas, setores, mensagens…")).toBeVisible();
        await blurActive(page);
        await shot(page, `palette--${tag}--light`);
        await page.keyboard.press("Escape");

        // Tema escuro manual — screenshots em escuro.
        await page.keyboard.press(KEY.ctrlComma);
        await page.getByRole("button", { name: "Tema escuro" }).click();
        await blurActive(page);
        await shot(page, `settings--${tag}--dark`);
        await page.keyboard.press("Escape");

        await blurActive(page);
        await shot(page, `conversa--${tag}--dark`, [channelRowText]);

        await page.keyboard.press(KEY.ctrlK);
        await expect(page.getByPlaceholder("Buscar pessoas, setores, mensagens…")).toBeVisible();
        await blurActive(page);
        await shot(page, `palette--${tag}--dark`);
        await page.keyboard.press("Escape");
      } finally {
        await closeApp(session.app);
      }
    });

    test(`admin (${tag}, claro e escuro)`, async ({ }) => {
      test.setTimeout(240_000);
      const session = await launchApp();
      try {
        const page = session.page;
        await setViewportSize(session.app, size);
        await page.emulateMedia({ colorScheme: "light" });

        await blurActive(page);
        await shot(page, `login--${tag}--light`);

        await loginViaUi(page, ADMIN);
        await page.getByRole("button", { name: "Administração" }).click();
        await expect(
          page.getByText("Usuários, setores e trilha de auditoria da instalação"),
        ).toBeVisible();

        await blurActive(page);
        await shot(page, `admin--${tag}--light`);

        await page.keyboard.press(KEY.ctrlComma);
        await page.getByRole("button", { name: "Tema escuro" }).click();
        await page.keyboard.press("Escape");

        await blurActive(page);
        await shot(page, `admin--${tag}--dark`);
      } finally {
        await closeApp(session.app);
      }
    });
  });
}
