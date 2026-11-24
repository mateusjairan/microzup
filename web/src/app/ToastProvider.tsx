import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ToastViewport, type ToastItemData, type ToastKind } from "../components/ui/Toast";

export type { ToastKind, ToastItemData } from "../components/ui/Toast";

export interface ToastSpec {
  id?: string;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastContextValue {
  /** Mostra um toast; retorna o id (para dispensa programática). */
  show: (spec: ToastSpec) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  show: () => "",
  dismiss: () => undefined,
});

export interface ToastProviderProps {
  /** Máx. visíveis ao mesmo tempo — o mais antigo sai primeiro. */
  maxVisible?: number;
  children: ReactNode;
}

function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/** Dono da fila de toasts; o visual vive em components/ui/Toast. */
export function ToastProvider({ maxVisible = 3, children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItemData[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (spec: ToastSpec) => {
      const id = spec.id ?? createToastId();
      const entry: ToastItemData = {
        id,
        kind: spec.kind,
        message: spec.message,
        actionLabel: spec.actionLabel,
        onAction: spec.onAction,
        durationMs: spec.durationMs,
      };
      setToasts((current) => {
        const next = [...current, entry];
        return next.length > maxVisible ? next.slice(next.length - maxVisible) : next;
      });
      return id;
    },
    [maxVisible],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
