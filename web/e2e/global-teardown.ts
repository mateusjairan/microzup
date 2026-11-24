/**
 * globalTeardown: mata TODOS os processos que a suíte subiu (backend na 8666)
 * e apaga os temporários (contextos do navegador, arquivo de 50 MB, logs).
 * O banco de dev NÃO é alterado (sem deletes) — fixtures ficam para reuso.
 * O último log do backend é preservado em e2e/.results para diagnóstico.
 */
import fs from "node:fs";
import path from "node:path";

import { E2E_TMP } from "./constants";
import { backendLogPath, stopBackend } from "./backend";
import { shutdownBrowser } from "./app";

export default async function globalTeardown(): Promise<void> {
  await shutdownBrowser();
  await stopBackend();
  try {
    if (fs.existsSync(backendLogPath())) {
      fs.mkdirSync(path.join(E2E_TMP, "..", ".results"), { recursive: true });
      fs.copyFileSync(backendLogPath(), path.join(E2E_TMP, "..", ".results", "backend-last.log"));
    }
  } catch {
    /* diagnóstico best-effort */
  }
  // O Chromium pode segurar locks de cache por instantes após o close —
  // tenta, espera e tenta de novo antes de desistir.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.rmSync(E2E_TMP, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 3) {
        console.log(`[e2e] aviso: temporários não removidos (${String(error).slice(0, 120)})`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  console.log("[e2e] backend encerrado; temporários (userData, logs, artefatos) removidos");
}
