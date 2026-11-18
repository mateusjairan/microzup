/**
 * Monitor de inatividade (powerMonitor):
 *  - auto-ausente: idle ≥ autoAwayMinutes (padrão 10) → evento idle:away;
 *    atividade de volta → idle:active (o renderer restaura o status anterior);
 *  - bloqueio de sessão: idle ≥ lockTimeoutMinutes (padrão 15, configurável)
 *    → evento session:locked; a UI desenha o overlay e a reautenticação
 *    preserva o estado do renderer (lib/boot.ts → reauthenticate).
 */
import { powerMonitor } from "electron";
import { IPC } from "./ipc-contract";
import type { IdleAwayEvent } from "./ipc-contract";
import { allAppWindows } from "./windows";
import { getCachedSettings } from "./persistence";

const POLL_INTERVAL_MS = 10_000;

let timer: ReturnType<typeof setInterval> | null = null;
let away = false;
let locked = false;

function broadcast(channel: string, payload: unknown): void {
  for (const win of allAppWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function checkIdle(): void {
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const settings = getCachedSettings();
  const autoAwaySeconds = Math.max(1, settings.autoAwayMinutes) * 60;
  const lockSeconds = Math.max(1, settings.lockTimeoutMinutes) * 60;

  if (!away && idleSeconds >= autoAwaySeconds) {
    away = true;
    const event: IdleAwayEvent = { idleMinutes: Math.floor(idleSeconds / 60) };
    broadcast(IPC.events.idleAway, event);
  } else if (away && idleSeconds < autoAwaySeconds) {
    away = false;
    broadcast(IPC.events.idleActive, {});
  }

  if (!locked && idleSeconds >= lockSeconds) {
    locked = true;
    broadcast(IPC.events.sessionLocked, {});
  } else if (locked && idleSeconds <= 5) {
    // Rearma depois de o usuário voltar a interagir.
    locked = false;
  }
}

export function startIdleMonitor(): void {
  stopIdleMonitor();
  timer = setInterval(checkIdle, POLL_INTERVAL_MS);
  checkIdle();
}

export function stopIdleMonitor(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Bloqueio imediato (Ctrl+Shift+L na UI → IPC session:lock). */
export function lockNow(): void {
  if (locked) return;
  locked = true;
  broadcast(IPC.events.sessionLocked, {});
}
