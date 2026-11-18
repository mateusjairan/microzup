/**
 * Playwright do cliente desktop Microzup (plano-frontend §14).
 *
 * Autocontido: o globalSetup sobe o backend real (porta 8666, `uv run python
 * -m app.run`, log em e2e/.tmp/backend.log) e cria as fixtures; o
 * globalTeardown MATA o processo. Se o backend não subir, a suíte FALHA —
 * nunca roda "no verde" sem servidor.
 *
 * workers=1: uma janela Electron por vez (foco de janela e backend compartilhado
 * tornam paralelismo não determinístico). As specs de resiliência matam e
 * religam o backend no meio do teste usando o PID trocado via arquivo.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "electron", testMatch: /.*\.spec\.ts$/ }],
});
