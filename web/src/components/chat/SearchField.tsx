import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";

export interface SearchFieldProps {
  value: string;
  /** Dispara a cada tecla (filtro local instantâneo, §8.7). */
  onChange: (value: string) => void;
  /** Dispara após `debounceMs` sem digitação (busca de mensagens). */
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  /** Esc com campo vazio (campo cheio: Esc limpa). */
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Campo de busca (§8.7): filtro local instantâneo via onChange e busca
 * debounced via onDebouncedChange (300 ms por padrão — prop, não timer fixo).
 */
export function SearchField({
  value,
  onChange,
  onDebouncedChange,
  debounceMs = 300,
  placeholder,
  onEscape,
  autoFocus = false,
  className,
}: SearchFieldProps) {
  const t = useI18n();
  const [internal, setInternal] = useState<string>(value);
  const lastEmittedRef = useRef<string>(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setInternal(value);
      lastEmittedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!onDebouncedChange) return;
    if (internal === lastEmittedRef.current) return;
    const timer = window.setTimeout(() => {
      lastEmittedRef.current = internal;
      onDebouncedChange(internal);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [internal, debounceMs, onDebouncedChange]);

  const commit = (next: string) => {
    setInternal(next);
    onChange(next);
  };

  return (
    <div className={`relative flex items-center ${className ?? ""}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 flex h-9 w-6 items-center justify-center text-[var(--text-3)]"
      >
        <Search size={14} strokeWidth={2} />
      </span>
      <input
        type="search"
        value={internal}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onChange={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (internal.length > 0) {
            event.stopPropagation();
            commit("");
          } else {
            onEscape?.();
          }
        }}
        className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] pl-8 pr-8 text-[length:var(--fs-list)] text-[var(--text)] outline-none placeholder:text-[var(--text-3)] [&::-webkit-search-cancel-button]:hidden"
      />
      {internal.length > 0 && (
        <button
          type="button"
          aria-label={t.ui.clear}
          onClick={() => commit("")}
          className="tz-colors absolute right-1 flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
