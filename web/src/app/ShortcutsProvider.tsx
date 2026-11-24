import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

/**
 * Atalhos globais (§10). O provider resolve a combinação e pergunta aos
 * escopos registrados — do topo (mais recente) para a base. O handler decide
 * se o evento lhe pertence (ex.: "↑" só edita a última mensagem quando o
 * alvo é o composer vazio) e devolve `true` para consumir o evento.
 */

export const SHORTCUT_ACTIONS = [
  "search",
  "newConversation",
  "prevConversation",
  "nextConversation",
  "markAllRead",
  "attach",
  "conversationSearch",
  "muteConversation",
  "settings",
  "lockSession",
  "close",
  "editLastMessage",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

export type ShortcutHandlers = {
  /** Ctrl+K — busca global */
  search?: ShortcutHandler;
  /** Ctrl+N — nova conversa direta */
  newConversation?: ShortcutHandler;
  /** Alt+↑ — conversa anterior */
  prevConversation?: ShortcutHandler;
  /** Alt+↓ — próxima conversa */
  nextConversation?: ShortcutHandler;
  /** Ctrl+Shift+A — marcar tudo como lido */
  markAllRead?: ShortcutHandler;
  /** Ctrl+O — anexar arquivo */
  attach?: ShortcutHandler;
  /** Ctrl+F — buscar dentro da conversa */
  conversationSearch?: ShortcutHandler;
  /** Ctrl+Shift+M — silenciar conversa */
  muteConversation?: ShortcutHandler;
  /** Ctrl+, — configurações */
  settings?: ShortcutHandler;
  /** Ctrl+Shift+L — bloquear sessão */
  lockSession?: ShortcutHandler;
  /** Esc — fecha painel / lightbox / palette */
  close?: ShortcutHandler;
  /** ↑ no composer vazio — editar a última mensagem enviada */
  editLastMessage?: ShortcutHandler;
};

interface ShortcutsContextValue {
  /** Registra um escopo; devolve a função que o remove. */
  registerScope: (id: string, handlers: ShortcutHandlers) => () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue>({
  registerScope: () => () => undefined,
});

/** Traduz o evento em uma ação do mapa; null se não é atalho do produto. */
export function matchShortcut(event: KeyboardEvent): ShortcutAction | null {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key;

  if (key === "Escape") return "close";
  if (event.altKey && !ctrl && key === "ArrowUp") return "prevConversation";
  if (event.altKey && !ctrl && key === "ArrowDown") return "nextConversation";
  if (event.altKey) return null;

  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (ctrl && event.shiftKey && lower === "a") return "markAllRead";
  if (ctrl && event.shiftKey && lower === "m") return "muteConversation";
  if (ctrl && event.shiftKey && lower === "l") return "lockSession";
  if (ctrl && event.shiftKey) return null;
  if (ctrl && lower === "k") return "search";
  if (ctrl && lower === "n") return "newConversation";
  if (ctrl && lower === "o") return "attach";
  if (ctrl && lower === "f") return "conversationSearch";
  if (ctrl && key === ",") return "settings";
  if (ctrl) return null;

  if (!event.shiftKey && key === "ArrowUp") return "editLastMessage";
  return null;
}

export interface ShortcutsProviderProps {
  children: ReactNode;
}

export function ShortcutsProvider({ children }: ShortcutsProviderProps) {
  const scopesRef = useRef(new Map<string, ShortcutHandlers>());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = matchShortcut(event);
      if (action === null) return;
      // Do escopo mais recente (topo: palette, lightbox…) para a base (app).
      const scopes = Array.from(scopesRef.current.values());
      for (let i = scopes.length - 1; i >= 0; i -= 1) {
        const handler = scopes[i][action];
        if (!handler) continue;
        if (handler(event) === true) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const registerScope = (id: string, handlers: ShortcutHandlers): (() => void) => {
    scopesRef.current.set(id, handlers);
    return () => {
      scopesRef.current.delete(id);
    };
  };

  return (
    <ShortcutsContext.Provider value={{ registerScope }}>
      {children}
    </ShortcutsContext.Provider>
  );
}

export function useShortcuts(): ShortcutsContextValue {
  return useContext(ShortcutsContext);
}

export interface UseShortcutScopeOptions {
  /** Identificador do escopo; omitir gera um id estável por componente. */
  id?: string;
  /** false remove o escopo (ex.: palette fechada não captura Esc). */
  enabled?: boolean;
}

/**
 * Registra um escopo de atalhos pelo tempo de vida do componente.
 * `handlers` pode mudar a cada render — o registro é feito uma única vez.
 */
export function useShortcutScope(
  handlers: ShortcutHandlers,
  options?: UseShortcutScopeOptions,
): void {
  const { registerScope } = useContext(ShortcutsContext);
  const generatedId = useId();
  const id = options?.id ?? `scope${generatedId}`;
  const enabled = options?.enabled ?? true;
  const latestRef = useRef(handlers);
  latestRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const proxy: ShortcutHandlers = {};
    for (const action of SHORTCUT_ACTIONS) {
      proxy[action] = (event: KeyboardEvent): boolean | void =>
        latestRef.current[action]?.(event);
    }
    return registerScope(id, proxy);
  }, [enabled, id, registerScope]);
}
