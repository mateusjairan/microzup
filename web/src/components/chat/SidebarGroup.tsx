import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface SidebarGroupProps {
  title: string;
  /** Contador discreto à direita (ex.: "SETORES 3"). */
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Grupo colapsável da sidebar (§4/§7): seta, título, contador.
 * Botão de 32 px com aria-expanded/aria-controls.
 */
export function SidebarGroup({
  title,
  count,
  collapsed,
  onToggle,
  children,
  className,
}: SidebarGroupProps) {
  const contentId = useId();

  return (
    <section className={className}>
      {/* Sem aria-label: o CONTEÚDO ("Setores 1") É o nome acessível — um
          rótulo divergente ("Seção Setores") viola Label-in-Name
          (axe label-content-name-mismatch; WCAG 2.5.3). */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        className="tz-colors flex h-8 w-full items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-meta)] font-semibold tracking-wide text-[var(--text-3)] uppercase hover:bg-[var(--bg-hover)]"
      >
        <ChevronRight
          size={12}
          strokeWidth={2.5}
          aria-hidden="true"
          className={`tz-panel shrink-0 ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="flex-1 truncate text-left">{title}</span>
        {typeof count === "number" && (
          <span aria-hidden="true" className="nums-tabular shrink-0 text-[var(--text-3)]">
            {count}
          </span>
        )}
      </button>
      {!collapsed && (
        <div id={contentId} role="group" aria-label={title} className="flex flex-col">
          {children}
        </div>
      )}
    </section>
  );
}
