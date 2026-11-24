import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../app/I18nProvider";
import { playSound } from "../../components/ui";
import { buildAnnouncement } from "../../components/utils/format";
import { useApp } from "../../store";

/**
 * Sons de notificação (§8.5, "opcional"): desligados por padrão — tocam
 * apenas com a preferência ligada. DND, conversa silenciada e
 * "janela focada na conversa ativa" suprimem, igual ao toast nativo.
 */
export function useNotificationSounds(soundsEnabled: boolean) {
  const enabledRef = useRef(soundsEnabled);
  enabledRef.current = soundsEnabled;

  useEffect(() => {
    const seenSeq = new Map<string, number>();
    let lastNudgeAt = 0;

    return useApp.subscribe((state) => {
      if (!enabledRef.current) return;

      // Mensagem nova por cursor de seq (paginação para trás também cresce
      // a lista e não deve tocar).
      for (const [conversationId, seq] of Object.entries(state.lastSeqByConversation)) {
        const previous = seenSeq.get(conversationId) ?? seq;
        seenSeq.set(conversationId, seq);
        if (seq <= previous) continue;
        const list = state.messagesByConversation[conversationId];
        const last = list === undefined ? undefined : list[list.length - 1];
        if (last === undefined || state.user === null) continue;
        if (last.sender_id === state.user.id) continue;
        if (state.myStatus === "dnd") continue;
        if (state.mutedConversations.includes(conversationId)) continue;
        if (state.activeConversationId === conversationId && state.windowFocused) continue;
        playSound("message", { enabled: true });
        break; // um som por ciclo — silêncio é a regra (§2)
      }

      // "Chamar atenção"
      const nudge = state.lastNudge;
      if (nudge !== null && nudge.at !== lastNudgeAt) {
        lastNudgeAt = nudge.at;
        if (state.myStatus !== "dnd" && !state.mutedConversations.includes(nudge.conversationId)) {
          playSound("nudge", { enabled: true });
        }
      }
    });
  }, []);
}

/**
 * Anúncio de leitor de tela no formato "Ana Souza: texto" (§10): apenas
 * quando a conversa NÃO está focada. Sem leitura duplicada: cada mensagem
 * é anunciada uma única vez (por cursor de seq).
 */
export function useMessageAnnouncer(): string | null {
  const t = useI18n();
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    const seenSeq = new Map<string, number>();
    return useApp.subscribe((state) => {
      for (const [conversationId, seq] of Object.entries(state.lastSeqByConversation)) {
        const previous = seenSeq.get(conversationId) ?? seq;
        seenSeq.set(conversationId, seq);
        if (seq <= previous) continue;
        if (state.user === null) continue;
        if (state.activeConversationId === conversationId && state.windowFocused) continue;
        const list = state.messagesByConversation[conversationId];
        const last = list === undefined ? undefined : list[list.length - 1];
        if (last === undefined) continue;
        if (last.sender_id === state.user.id) continue;
        if (last.deleted_at !== null) continue;
        const sender =
          state.users.find((user) => user.id === last.sender_id)?.display_name ?? t.nav.unknownUser;
        // Corpo vazio = mensagem só de anexo (o WS embute attachment_ids; o
        // REST não — o corpo vazio é o sinal estável nos dois).
        const body = last.body.trim() === "" ? t.notifications.attachment : last.body;
        setAnnouncement(buildAnnouncement(t.chat.message.announcement, sender, body));
        break;
      }
    });
  }, [setAnnouncement, t]);

  return announcement;
}
