export interface SkeletonProps {
  /** "list" = linhas de contato · "message" = bolhas · "details" = painel · "generic" = barra única. */
  variant: "list" | "message" | "details" | "generic";
  rows?: number;
  className?: string;
}

const PULSE = "mz-skeleton-pulse 1.6s ease-in-out infinite";

function Bar({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-[var(--radius-sm)] bg-[var(--bg-hover)] ${className}`}
      style={{ animation: PULSE }}
    />
  );
}

/** Placeholder de carregamento (§7): decorativo, sem texto, pulso morre em reduced-motion. */
export function Skeleton({ variant, rows = 5, className }: SkeletonProps) {
  const body = (() => {
    if (variant === "list") {
      const count = Math.max(1, rows);
      return (
        <div className="flex flex-col gap-1" role="presentation">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="flex h-8 items-center gap-2">
              <Bar className="h-6 w-6 rounded-[var(--radius-full)]" />
              <Bar className="h-3 w-1/3" />
              <Bar className="ml-auto h-3 w-8" />
            </div>
          ))}
        </div>
      );
    }
    if (variant === "message") {
      const count = Math.max(1, rows);
      return (
        <div className="flex flex-col gap-3" role="presentation">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className={index % 2 === 1 ? "flex justify-end" : "flex justify-start"}>
              <div className="flex max-w-[60%] flex-col gap-1.5">
                <Bar className="h-3 w-24" />
                <Bar className="h-14 w-full rounded-[var(--radius-md)]" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (variant === "details") {
      return (
        <div className="flex flex-col gap-2" role="presentation">
          <Bar className="h-4 w-1/2" />
          <Bar className="h-3 w-1/4" />
          {Array.from({ length: Math.max(1, rows) }, (_, index) => (
            <div key={index} className="mt-2 flex h-8 items-center gap-2 border-t border-[var(--border)]">
              <Bar className="h-5 w-5 rounded-[var(--radius-full)]" />
              <Bar className="h-3 flex-1" />
            </div>
          ))}
        </div>
      );
    }
    return <Bar className="h-8 w-full" />;
  })();

  return <div aria-hidden="true" className={className}>{body}</div>;
}
