export interface MessageAnnouncerProps {
  /** Anúncio no formato "Ana Souza: texto" (§10) — montado pelo chamador. */
  text: string | null;
}

/**
 * Região aria-live polite (§10): anuncia "Ana Souza: texto" quando a
 * conversa não está focada. O chamador limpa o texto para evitar leitura
 * duplicada — a região nunca acumula histórico.
 */
export function MessageAnnouncer({ text }: MessageAnnouncerProps) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {text ?? ""}
    </div>
  );
}
