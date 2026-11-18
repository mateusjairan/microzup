/**
 * Bandeja (tray): ícone com ponto de não lidas, menu Abrir/Status/Sair.
 * O badge numérico completo vai como overlay da barra de tarefas
 * (win.setOverlayIcon); o ícone da bandeja ganha um ponto vermelho.
 *
 * Os rótulos do menu vivem aqui (pt-BR) porque o processo main não importa o
 * i18n do renderer; corpos de notificação continuam vindo traduzidos do
 * renderer (decisão registrada no relatório).
 */
import { Menu, Tray, app, nativeImage } from "electron";
import { IPC } from "./ipc-contract";
import type { PresenceValue } from "./ipc-contract";
import { badgeImage, trayImage } from "./images";
import { allAppWindows, markQuitting, showMainWindow } from "./windows";

const STATUS_OPTIONS: Array<{ label: string; status: PresenceValue }> = [
  { label: "Disponível", status: "available" },
  { label: "Ocupado", status: "busy" },
  { label: "Ausente", status: "away" },
  { label: "Não perturbe", status: "dnd" },
  { label: "Invisível", status: "invisible" },
];

let tray: Tray | null = null;

function sendToRenderers(channel: string, payload: unknown): void {
  for (const win of allAppWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function buildMenu(): Menu {
  const template = [
    { label: "Abrir Microzup", click: () => showMainWindow() },
    {
      label: "Status",
      submenu: STATUS_OPTIONS.map((option) => ({
        label: option.label,
        click: () => {
          showMainWindow();
          sendToRenderers(IPC.events.presenceSetRequested, { status: option.status });
        },
      })),
    },
    { type: "separator" as const },
    {
      label: "Sair",
      click: () => {
        markQuitting();
        app.quit();
      },
    },
  ];
  return Menu.buildFromTemplate(template);
}

export function initTray(): void {
  if (tray !== null) return;
  tray = new Tray(trayImage(false));
  tray.setToolTip("Microzup");
  tray.setContextMenu(buildMenu());
  tray.on("click", () => showMainWindow());
}

/** Sincroniza badge: overlay na taskbar + ponto no ícone da bandeja. */
export function setUnread(count: number): void {
  if (tray === null) return;
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  tray.setImage(trayImage(safeCount > 0));
  tray.setToolTip(safeCount > 0 ? `Microzup — ${safeCount} não lidas` : "Microzup");
  for (const win of allAppWindows()) {
    if (win.isDestroyed()) continue;
    if (safeCount > 0) {
      win.setOverlayIcon(badgeImage(safeCount), `${safeCount} mensagens não lidas`);
    } else {
      win.setOverlayIcon(nativeImage.createEmpty(), "");
    }
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
