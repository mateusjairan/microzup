/**
 * Sessão de navegador da suíte + helpers de UI compartilhados pelas specs.
 *
 * Cada `launchApp()` abre um CONTEXTO Chromium isolado (cookies e storage
 * próprios) — o equivalente às janelas Electron separadas que existiam antes.
 * Presença e "duas sessões simultâneas" continuam testáveis sem shell nativo.
 *
 * O app testado é o build real de `web/dist`, servido pelo backend na 8666
 * (globalSetup sobe `uv run python -m app.run`).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { BASE_URL } from "./constants";
import type { TestUser } from "./constants";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser === null) browser = await chromium.launch();
  return browser;
}

export interface AppSession {
  /** Contexto do navegador (equivale ao "app" do Electron: closeApp fecha). */
  app: BrowserContext;
  page: Page;
  /** Mantido por compatibilidade de assinatura com as specs existentes. */
  userData: string;
}

/** Envia mensagens de teclado com a sintaxe do Playwright. */
export const KEY = {
  ctrlK: "Control+k",
  ctrlN: "Control+n",
  ctrlF: "Control+f",
  ctrlComma: "Control+Comma",
  ctrlShiftA: "Control+Shift+a",
  ctrlShiftL: "Control+Shift+l",
  altDown: "Alt+ArrowDown",
  altUp: "Alt+ArrowUp",
} as const;

/** Abre o app web num contexto limpo; opcionalmente já faz login pela UI. */
export async function launchApp(options: { loginAs?: TestUser } = {}): Promise<AppSession> {
  const browserInstance = await getBrowser();
  const context = await browserInstance.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // Erros do renderer aparecem no log da suíte (falhas ficam diagnosticáveis).
  page.on("pageerror", (error) => {
    console.log(`[renderer-error] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`[renderer-console-error] ${message.text()}`);
    }
  });

  await page.goto("/");
  if (options.loginAs !== undefined) {
    await loginViaUi(page, options.loginAs);
  }
  return { app: context, page, userData: "" };
}

/** Fecha o contexto (cookies/storage descartados). */
export async function closeApp(context: BrowserContext | null | undefined): Promise<void> {
  if (context === undefined || context === null) return;
  await context.close().catch(() => undefined);
}

/** Encerra o navegador compartilhado da suíte (chamado no teardown). */
export async function shutdownBrowser(): Promise<void> {
  await browser?.close().catch(() => undefined);
  browser = null;
}

// ---------------------------------------------------------------------------
// Fluxos de UI
// ---------------------------------------------------------------------------

/** Primeira execução: credenciais e entra no shell. */
export async function loginViaUi(page: Page, user: TestUser): Promise<void> {
  await page.locator("#login-username").waitFor({ state: "visible", timeout: 30_000 });

  const connected = page.locator("aside").getByText("Conectado", { exact: true });
  const blockedAlert = page.getByText(/Muitas tentativas incorretas/);

  for (let attempt = 1; ; attempt += 1) {
    await page.locator("#login-username").fill(user.username);
    await page.locator("#login-password").fill(user.password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // Login tem rate limit de 10/min POR IP no servidor: janelas da suíte
    // podem encostar no limite — o app mostra o estado "bloqueado por
    // tentativas" (§5) e a suíte RESPEITA a janela em vez de falhar.
    const deadline = Date.now() + 25_000;
    let blocked = false;
    while (Date.now() < deadline) {
      if (await connected.isVisible().catch(() => false)) break;
      if (await blockedAlert.isVisible().catch(() => false)) {
        blocked = true;
        break;
      }
      await page.waitForTimeout(400);
    }

    if (await connected.isVisible().catch(() => false)) break;
    if (blocked) {
      if (attempt >= 3) {
        throw new Error(
          `loginViaUi: ${user.username} ainda bloqueado por rate limit após ${attempt} tentativas`,
        );
      }
      console.log(`[login] ${user.username} bateu o rate limit (429) — aguardando 65 s`);
      await page.waitForTimeout(65_000);
      continue;
    }

    const bodyText = await page.locator("body").innerText().catch(() => "<sem corpo>");
    throw new Error(
      `loginViaUi não chegou ao shell (${user.username}). Página na hora da falha:\n` +
        `${bodyText.slice(0, 500)}`,
    );
  }
}

/** Grupo da sidebar por rótulo (role=group com aria-label em pt-BR). */
export function sidebarGroup(page: Page, name: "Setores" | "Conversas" | "Equipe") {
  return page.getByRole("group", { name, exact: true });
}

/**
 * Linha de contato/conversa da sidebar. O nome acessível inclui preview E,
 * em DMs, o rótulo de presença do avatar ("Offline Bruno Lima (E2E)"),
 * então casamos o nome como PALAVRA dentro do rótulo (grupos garantem
 * unicidade: Setores/Conversas não têm as linhas da Equipe).
 */
export function contactRow(
  page: Page,
  group: "Setores" | "Conversas" | "Equipe",
  name: string,
) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sidebarGroup(page, group).getByRole("button", {
    name: new RegExp(`(^|\\s)${escaped}(\\s|$)`),
  });
}

/** Clica na linha da sidebar (canal em Setores, DM em Conversas) e espera o composer. */
export async function openConversation(
  page: Page,
  name: string,
  group: "Setores" | "Conversas" = "Setores",
): Promise<void> {
  await contactRow(page, group, name).first().click();
  await composer(page).waitFor({ state: "visible", timeout: 15_000 });
}

/** Textarea do composer (aria-label em pt-BR). */
export function composer(page: Page) {
  return page.getByLabel("Escreva uma mensagem…");
}

/** Envia texto pelo composer e espera Enter. */
export async function sendViaComposer(page: Page, body: string): Promise<void> {
  await composer(page).fill(body);
  await composer(page).press("Enter");
}

/** Distância (px) do fim do scroll virtualizado; NaN se não achar o scroller. */
export async function distanceFromBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroller =
      document.querySelector('[data-test-id="virtuoso-scroller"]') ??
      document.querySelector('[role="feed"] div[style*="overflow"]');
    if (scroller === null) return Number.NaN;
    const element = scroller as HTMLElement;
    return element.scrollHeight - element.scrollTop - element.clientHeight;
  });
}

/** scrollTop atual do scroller (para provar que o scroll NÃO pulou). */
export async function feedScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scroller =
      document.querySelector('[data-test-id="virtuoso-scroller"]') ??
      document.querySelector('[role="feed"] div[style*="overflow"]');
    if (scroller === null) return Number.NaN;
    return (scroller as HTMLElement).scrollTop;
  });
}

/** Banner de reconexão (role=status, "Reconectando (n/∞)"). */
export function reconnectBanner(page: Page) {
  return page.getByRole("status").filter({ hasText: /Reconectando \(\d+\/∞\)/ });
}

/** Artigo de mensagem por corpo exato, restrito ao feed (exclui preview da sidebar). */
export function feedMessage(page: Page, body: string) {
  return page.getByRole("feed").getByText(body, { exact: true });
}
