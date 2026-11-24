/**
 * Regressão: "Hoje" repetido em toda mensagem (§7).
 *
 * O bug: a lista é virtualizada com `firstItemIndex` (base 100.000) e as flags
 * de item eram indexadas pelo índice ABSOLUTO que o Virtuoso entrega ao
 * `itemContent` — sempre fora do array → o item caía no fallback
 * `{ dayChanged: true }` e cada mensagem ganhava um divisor de dia.
 *
 * Este spec trava as duas pontas: o cálculo (um divisor por dia) e a resolução
 * por id (imune ao offset do Virtuoso). Roda sem navegador — é lógica pura.
 */
import { expect, test } from "@playwright/test";

import { buildFlagIndex, computeItemFlags, isSameDay } from "../src/features/messages/itemFlags";
import type { ChatMessage } from "../src/components/chat/types";

const SENDER_A = "11111111-1111-4111-8111-111111111111";
const SENDER_B = "22222222-2222-4222-8222-222222222222";

function message(id: string, createdAt: string, senderId = SENDER_A): ChatMessage {
  return {
    id,
    seq: Number(id.replace(/\D/g, "")) || 1,
    senderId,
    senderName: senderId === SENDER_A ? "Alice" : "Bruno",
    createdAt,
    body: `msg-${id}`,
    delivery: "sent",
  };
}

const TODAY_AT_10_01 = "2026-11-19T13:01:00.000Z";
const TODAY_AT_10_02 = "2026-11-19T13:02:00.000Z";
const TODAY_AT_10_09 = "2026-11-19T13:09:00.000Z";
const YESTERDAY_AT_18_00 = "2026-11-18T21:00:00.000Z";

test.describe("divisor de dia: um por dia, nunca por mensagem", () => {
  test("mesmo dia e mesmo autor: só a primeira mensagem abre o dia", () => {
    const messages = [
      message("m1", TODAY_AT_10_01),
      message("m2", TODAY_AT_10_02),
      message("m3", TODAY_AT_10_09),
    ];
    const flags = computeItemFlags(messages, null);

    expect(flags.map((flag) => flag.dayChanged)).toEqual([true, false, false]);
    // Mesmo autor, 1 min e 7 min depois: a segunda agrupa, a terceira não
    // (janela de 5 min conta desde a mensagem imediatamente anterior).
    expect(flags.map((flag) => flag.grouped)).toEqual([false, true, false]);
    expect(isSameDay(TODAY_AT_10_01, TODAY_AT_10_09)).toBe(true);
    expect(isSameDay(YESTERDAY_AT_18_00, TODAY_AT_10_01)).toBe(false);
  });

  test("virada de dia abre divisor novo; autor diferente quebra o agrupamento", () => {
    const messages = [
      message("m1", YESTERDAY_AT_18_00),
      message("m2", TODAY_AT_10_01, SENDER_B),
      message("m3", TODAY_AT_10_02, SENDER_B),
    ];
    const flags = computeItemFlags(messages, null);

    expect(flags.map((flag) => flag.dayChanged)).toEqual([true, true, false]);
    expect(flags.map((flag) => flag.grouped)).toEqual([false, false, true]);
  });

  test("mapa por id cobre todos os itens (o lookup não depende do firstItemIndex)", () => {
    const messages = [
      message("m1", TODAY_AT_10_01),
      message("m2", TODAY_AT_10_02),
      message("m3", TODAY_AT_10_09),
    ];
    const byId = buildFlagIndex(messages, null);

    expect(byId.size).toBe(messages.length);
    for (const item of messages) {
      expect(byId.get(item.id)).toBeDefined();
    }
    // A mensagem 2 NÃO pode abrir um segundo "Hoje" — era exatamente isso que
    // o fallback do índice absoluto fazia.
    expect(byId.get("m2")?.dayChanged).toBe(false);
    expect(byId.get("m3")?.dayChanged).toBe(false);
  });

  test("divisor de não lidas marca só a seq correspondente", () => {
    const messages = [
      message("m1", TODAY_AT_10_01),
      message("m2", TODAY_AT_10_02),
      message("m3", TODAY_AT_10_09),
    ];
    const byId = buildFlagIndex(messages, messages[1]?.seq ?? null);

    expect(byId.get("m1")?.firstUnread).toBe(false);
    expect(byId.get("m2")?.firstUnread).toBe(true);
    expect(byId.get("m3")?.firstUnread).toBe(false);
  });
});
