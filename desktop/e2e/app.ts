/**
 * Lançamento do app Electron REAL via `_electron` (playwright-core) + helpers
 * de UI compartilhados pelas specs.
 *
 * Decisões de ambiente (detalhadas em e2e/README.md):
 *  - `ELECTRON_RUN_AS_NODE` é definido pelo host desta sessão e NÃO é
 *    removido pelo Playwright — precisa sair do env antes de lançar, senão o
 *    Electron sobe como Node puro e o app morre em `app.requestSingleInstanceLock`.
 *  - Nesta máquina o binário electron.exe recebe EPERM para gravar sob
 *    %APPDATA% (perfis de usuário) — o userData é redirecionado via
 *    `--user-data-dir` para dentro do workspace (e2e/.tmp), onde a gravação
 *    funciona; o Chromium sandbox quebra aqui (STATUS_BREAKPOINT), por isso
 *    `--no-sandbox`. O lock de instância única é POR user-data-dir: cada spec
 *    usa um diretório próprio (e duas janelas podem coexistir na spec de
 *    presença).
 */
import { _electron, type ElectronApplication } from "playwright-core";
import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { BASE_URL, DESKTOP_DIR, E2E_TMP } from "./constants";
import type { TestUser } from "./constants";

export interface AppSession {
  app: ElectronApplication;
  page: Page;
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

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // O host da sessão define 1; o Electron checa por PRESENÇA da variável e
  // subiria como Node puro (app morto em requestSingleInstanceLock).
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Abre o app Electron real; opcionalmente já faz login pela UI. */
export async function launchApp(options: { loginAs?: TestUser } = {}): Promise<AppSession> {
  fs.mkdirSync(E2E_TMP, { recursive: true });
  const userData = fs.mkdtempSync(path.join(E2E_TMP, "userdata-"));

  const app = await _electron.launch({
    cwd: DESKTOP_DIR,
    args: ["--no-sandbox", `--user-data-dir=${userData}`, DESKTOP_DIR],
    env: sanitizedEnv(),
  });

  const page = (await app.firstWindow({ timeout: 40_000 })) as unknown as Page;

  // Erros do renderer aparecem no log da suíte (falhas ficam diagnosticáveis).
  page.on("pageerror", (error) => {
    console.log(`[renderer-error] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.log(`[renderer-console-error] ${message.text()}`);
    }
  });

  if (options.loginAs !== undefined) {
    await loginViaUi(page, options.loginAs);
  }
  return { app, page, userData };
}

/** Fecha o app (graceful; fallback mata a árvore do processo). */
export async function closeApp(app: ElectronApplication): Promise<void> {
  try {
    await app.close();
  } catch {
    const pid = app.process()?.pid;
    if (pid !== undefined) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Fluxos de UI
// ---------------------------------------------------------------------------

/** Primeira execução: pede servidor + credenciais e entra no shell. */
export async function loginViaUi(page: Page, user: TestUser, serverUrl = BASE_URL): Promise<void> {
  await page.locator("#login-server").waitFor({ state: "visible", timeout: 30_000 });

  const connected = page.locator("aside").getByText("Conectado", { exact: true });
  const blockedAlert = page.getByText(/Muitas tentativas incorretas/);

  for (let attempt = 1; ; attempt += 1) {
    await page.locator("#login-server").fill(serverUrl);
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

/** scrollTop atual do scroller (para provar que o scroll NÃO pularou). */
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

/**
 * Troca o tamanho da janela (conteúdo = viewport, janela frameless) para os
 * baselines visuais em 1024×680, 1280×800 e 1440×900.
 */
export async function setViewportSize(
  app: ElectronApplication,
  size: { width: number; height: number },
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setContentSize(width, height);
      }
    },
    size,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
}
