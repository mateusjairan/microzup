/**
 * Playwright do cliente WEB Microzup.
 *
 * O globalSetup sobe o backend real (porta 8666), que também serve o build do
 * SPA em `/` — os testes exercitam exatamente o artefato de produção, sem
 * servidor estático extra. `npm run test:e2e` compila antes de rodar; se o
 * build não existir, o setup falha explicitamente.
 *
 * workers=1: backend e banco de dev compartilhados tornam o paralelismo não
 * determinístico. As specs de resiliência matam/religam o backend no meio do
 * teste usando o PID trocado via arquivo.
 */
import { defineConfig, devices } from "@playwright/test";

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
    baseURL: "http://127.0.0.1:8666",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
