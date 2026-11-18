/**
 * Spec (§14): axe-core em TODAS as telas — login, shell com conversa, palette
 * de busca, settings, admin e overlays de sessão (bloqueada e expirada).
 *
 * Meta do plano: ZERO violações serious/critical (WCAG 2.1 AA). Violations
 * moderate/minor são logadas para o relatório, sem falhar a suíte.
 *
 * Nota técnica: o wrapper `@axe-core/playwright` abre uma página auxiliar no
 * contexto (browserContext.newPage) — operação que o Electron não suporta
 * ("Target.createTarget: Not supported"). Rodo o MESMO motor axe-core
 * (mesma dependência, mesmas tags WCAG) direto na página via addScriptTag +
 * window.axe.run — abordagem documentada da própria Deque para Electron.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { ADMIN, ALICE, CHANNEL_NAME } from "./constants";
import {
  KEY,
  closeApp,
  composer,
  launchApp,
  loginViaUi,
  openConversation,
  type AppSession,
} from "./app";

const IMPACT_BLOCKLIST = ["serious", "critical"];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
}

let axeSource: string | null = null;

function loadAxeSource(): string {
  if (axeSource === null) {
    axeSource = readFileSync(
      path.join(__dirname, "..", "node_modules", "axe-core", "axe.min.js"),
      "utf8",
    );
  }
  return axeSource;
}

interface ViolationSummary {
  id: string;
  impact: string | null;
  nodes: number;
  help: string;
}

async function scan(
  page: Page,
  screen: string,
  testInfo: { attach: (name: string, options: { body: string; contentType: string }) => void },
): Promise<void> {
  // Congela animações/transições (evaluate é imune ao CSP): overlays em
  // fade-in deixam o fundo translúcido e o axe não consegue calcular
  // contraste durante a animação.
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent =
      "*, *::before, *::after { animation: none !important; transition: none !important; }";
    document.head.appendChild(style);
  });
  // page.evaluate roda via CDP (Runtime.evaluate) — imune ao CSP do app
  // (que bloqueia <script> inline — correto e mantido intacto).
  await page.evaluate(`(() => { ${loadAxeSource()} })()`);
  const results = await page.evaluate(
    (tags: string[]): Promise<{ violations: AxeViolation[] }> =>
      (window as unknown as {
        axe: {
          run: (
            context: Document,
            options: { runOnly: { type: string; values: string[] } },
          ) => Promise<{ violations: AxeViolation[] }>;
        };
      }).axe.run(document, { runOnly: { type: "tag", values: tags } }),
    AXE_TAGS,
  );

  const violations: ViolationSummary[] = (results.violations ?? []).map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    nodes: violation.nodes.length,
    help: violation.help,
  }));
  const blocking = violations.filter((violation) => {
    const impact = violation.impact ?? "";
    return IMPACT_BLOCKLIST.includes(impact);
  });

  if (violations.length > 0) {
    const details = (results.violations ?? []).map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 6).map((node) => ({
        target: node.target.join(" > "),
        html: node.html.slice(0, 200),
      })),
      totalNodes: violation.nodes.length,
    }));
    testInfo.attach(`axe-${screen}`, {
      body: JSON.stringify(details, null, 2),
      contentType: "application/json",
    });
    console.log(`[axe:${screen}] ${JSON.stringify(details)}`);
  } else {
    console.log(`[axe:${screen}] sem violações`);
  }

  expect(
    blocking,
    `${screen}: violações serious/critical devem ser zero — ${JSON.stringify(blocking)}`,
  ).toEqual([]);
}

test.describe("axe-core por tela", () => {
  test("login", async ({ }, testInfo) => {
    let session: AppSession | null = null;
    try {
      session = await launchApp();
      await session.page.locator("#login-server").waitFor({ state: "visible", timeout: 30_000 });
      await scan(session.page, "login", testInfo);
    } finally {
      if (session !== null) await closeApp(session.app);
    }
  });

  test("shell com conversa, palette e settings", async ({ }, testInfo) => {
    let session: AppSession | null = null;
    try {
      session = await launchApp({ loginAs: ALICE });
      const page = session.page;
      await openConversation(page, CHANNEL_NAME);

      await scan(page, "conversa", testInfo);

      await page.keyboard.press(KEY.ctrlK);
      await expect(page.getByPlaceholder("Buscar pessoas, setores, mensagens…")).toBeVisible();
      await scan(page, "palette", testInfo);
      await page.keyboard.press("Escape");

      await page.keyboard.press(KEY.ctrlComma);
      await expect(page.getByText("Configurações")).toBeVisible();
      await scan(page, "settings", testInfo);
      await page.keyboard.press("Escape");
    } finally {
      if (session !== null) await closeApp(session.app);
    }
  });

  /**
   * Overlay de sessão — DOIS modos:
   *  - "bloqueada" (Ctrl+Shift+L → IPC): ponte viva (BUG-1 corrigido — preload
   *    empacotado); scan direto.
   *  - "expirada": 100% renderer; a condição é simulada por interceptação
   *    (401 na chamada autenticada + refresh recusado — TTL real de 15 min)
   *    e a REAUTENTICAÇÃO é real (login de verdade, rascunho preservado).
   */
  test("overlays de sessão (bloqueada e expirada)", async ({ }, testInfo) => {
    let session: AppSession | null = null;
    try {
      session = await launchApp({ loginAs: ALICE });
      const page = session.page;
      await openConversation(page, CHANNEL_NAME);

      const hasBridge = await page.evaluate(
        () => (window as unknown as { microzup?: unknown }).microzup !== undefined,
      );
      if (hasBridge) {
        await page.keyboard.press(KEY.ctrlShiftL);
        await expect(page.getByText("Sessão bloqueada")).toBeVisible({ timeout: 10_000 });
        await scan(page, "overlay-bloqueio", testInfo);
        await page.locator("#reauth-password").fill(ALICE.password);
        await page.getByRole("button", { name: "Desbloquear" }).click();
        await expect(page.getByText("Sessão bloqueada")).toBeHidden({ timeout: 20_000 });
      } else {
        test.skip(true, "BUG-1: ponte IPC ausente — overlay de bloqueio inacessível");
      }

      const draft = `rascunho-exp-${Date.now()}`;
      await composer(page).fill(draft);

      // Foco determinístico: o markRead só dispara com windowFocused — o
      // foco do SO pode oscilar em sessão automatizada; traz a janela e
      // sinaliza o evento de foco no renderer (mesmo listener do app).
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));

      // Simulação da expiração: chamada autenticada e refresh respondem 401.
      await page.route("**/auth/refresh", (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "invalid_token", message: "token revogado" } }),
        }),
      );
      await page.route("**/conversations/*/read", (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "invalid_token", message: "expirado" } }),
        }),
      );

      // O overlay de expiração dispara por uma chamada autenticada que falha:
      // markRead só chama a API quando a conversa tem mensagens (lastSeq>0) —
      // a DM de fixture pode estar vazia (a seed do visual.spec é posterior),
      // então sai para a DM e VOLTA ao canal, que sempre tem histórico.
      await openConversation(page, "Bruno Lima (E2E)", "Conversas");
      await expect(
        page.getByRole("group", { name: "Conversas" }).getByRole("button", {
          name: /Bruno Lima \(E2E\)/,
        }),
      ).toHaveAttribute("aria-current", "true");
      await openConversation(page, CHANNEL_NAME);
      // Escopo do dialog: o rodapé da sidebar também exibe
      // "Sessão expirada. Entre novamente." (getText por substring).
      const expiredOverlay = page.getByRole("dialog").filter({
        hasText: "Sessão expirada",
      });
      await expect(expiredOverlay).toBeVisible({ timeout: 20_000 });
      await scan(page, "overlay-sessao-expirada", testInfo);

      // Reautenticação REAL: rotas liberadas, login de verdade, rascunho ok.
      await page.unroute("**/auth/refresh");
      await page.unroute("**/conversations/*/read");
      await page.locator("#reauth-password").fill(ALICE.password);
      await page.getByRole("button", { name: "Desbloquear" }).click();
      await expect(expiredOverlay).toBeHidden({ timeout: 20_000 });
      await expect(composer(page)).toBeVisible();
      await expect(composer(page)).toHaveValue(draft);
    } finally {
      if (session !== null) await closeApp(session.app);
    }
  });

  test("painel admin (usuário admin)", async ({ }, testInfo) => {
    let session: AppSession | null = null;
    try {
      session = await launchApp();
      const page = session.page;
      await loginViaUi(page, ADMIN);

      await page.getByRole("button", { name: "Administração" }).click();
      await expect(
        page.getByText("Usuários, setores e trilha de auditoria da instalação"),
      ).toBeVisible();
      await scan(page, "admin", testInfo);
    } finally {
      if (session !== null) await closeApp(session.app);
    }
  });
});
