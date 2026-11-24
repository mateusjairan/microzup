import { useCallback } from "react";
import messageSound from "../../assets/sounds/message.wav";
import nudgeSound from "../../assets/sounds/nudge.wav";

/**
 * Som do produto (§2/§3): DOIS sons discretos e DESLIGADOS por padrão —
 * silêncio é a regra. Nada de autoplay: `enabled` vem do usuário (wiring).
 */

export type SoundName = "message" | "nudge";

export const SOUND_SRC: Record<SoundName, string> = {
  message: messageSound,
  nudge: nudgeSound,
};

export interface PlaySoundOptions {
  /** Desligado por padrão (plano §2). */
  enabled?: boolean;
  /** Volume de 0 a 1; padrão discreto. */
  volume?: number;
}

export function playSound(name: SoundName, { enabled = false, volume = 0.35 }: PlaySoundOptions = {}): void {
  if (!enabled) return;
  if (typeof Audio === "undefined") return;
  const audio = new Audio(SOUND_SRC[name]);
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => {
    // Política de autoplay ou dispositivo sem saída — silêncio é aceitável.
  });
}

export function useSound({ enabled = false, volume = 0.35 }: PlaySoundOptions = {}) {
  const play = useCallback(
    (name: SoundName) => {
      playSound(name, { enabled, volume });
    },
    [enabled, volume],
  );
  return play;
}
