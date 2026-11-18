import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale/pt-BR";

/**
 * Utilitários de formatação puros (sem dependência de store/lib do projeto).
 * Textos visíveis entram por parâmetro — quem chama passa as chaves do i18n.
 */

/** "Ana Souza" → "AS" · "Marcos" → "MA" · determinístico. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Índice determinístico (0–5) da paleta de avatar para um nome. */
export function avatarIndex(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return sum % 6;
}

export interface SizeUnits {
  b: string;
  kb: string;
  mb: string;
  gb: string;
}

/** 2 202 009 → "2,1 MB" (decimal pt-BR, uma casa; números tabulares no CSS). */
export function formatFileSize(bytes: number, units: SizeUnits): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  const oneDecimal = (value: number): string => value.toFixed(1).replace(".", ",");
  if (bytes < kb) return `${Math.max(0, Math.round(bytes))} ${units.b}`;
  if (bytes < mb) return `${oneDecimal(bytes / kb)} ${units.kb}`;
  if (bytes < gb) return `${oneDecimal(bytes / mb)} ${units.mb}`;
  return `${oneDecimal(bytes / gb)} ${units.gb}`;
}

/** Horário 24 h — "09:41". */
export function formatClock(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

export interface DayLabels {
  today: string;
  yesterday: string;
}

/** Divisor de dia: "Hoje" / "Ontem" / "14 de fevereiro de 2026" (§7 DayDivider). */
export function formatDayLabel(iso: string, labels: DayLabels): string {
  const date = new Date(iso);
  if (isToday(date)) return labels.today;
  if (isYesterday(date)) return labels.yesterday;
  return format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

/** "14/02/2026 09:43" — tooltip de mensagem editada. */
export function formatDateTime(iso: string): string {
  return format(new Date(iso), "dd/MM/yyyy HH:mm");
}

/** Interpola "{chave}" em templates do i18n. */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/** Anúncio de leitor de tela no formato "Ana Souza: texto" (§10). */
export function buildAnnouncement(template: string, senderName: string, text: string): string {
  return interpolate(template, { name: senderName, text });
}

/** Janela de agrupamento de mensagens do mesmo autor (§7: 5 min). */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;
