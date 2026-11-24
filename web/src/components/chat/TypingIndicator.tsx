import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../utils/format";
import type { TypingPerson } from "./types";

export interface TypingIndicatorProps {
  /** 1–3 pessoas digitando; acima disso vira "várias pessoas". */
  people: TypingPerson[];
  className?: string;
}

/**
 * "Ana está digitando…" (§3/§7): 1 a 3 pessoas, 3 pontos animados.
 * prefers-reduced-motion desliga os pontos (corte seco em tokens.css);
 * o texto permanece — informação nunca depende da animação.
 */
export function TypingIndicator({ people, className }: TypingIndicatorProps) {
  const t = useI18n();
  const names = people.map((person) => person.name);

  let text: string;
  if (names.length === 0) {
    return null;
  } else if (names.length === 1) {
    text = interpolate(t.chat.typing.one, { a: names[0] });
  } else if (names.length === 2) {
    text = interpolate(t.chat.typing.two, { a: names[0], b: names[1] });
  } else if (names.length === 3) {
    text = interpolate(t.chat.typing.many, { a: names[0], b: names[1], c: names[2] });
  } else {
    text = t.chat.typing.overflow;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 ${className ?? ""}`} aria-hidden={false}>
      <span aria-hidden="true" className="flex items-center gap-1 pl-1">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="inline-block h-1.5 w-1.5 rounded-[var(--radius-full)] bg-[var(--text-3)]"
            style={{ animation: `mz-typing-dot 1.2s ${dot * 0.15}s ease-in-out infinite` }}
          />
        ))}
      </span>
      <span className="text-[length:var(--fs-meta)] text-[var(--text-3)]">{text}</span>
    </div>
  );
}
