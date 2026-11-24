import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  resolvedTheme: "light",
  setPreference: () => undefined,
});

export interface ThemeProviderProps {
  /** Modo escolhido de fora (controlado — wiring liga à persistência). */
  preference?: ThemePreference;
  /** Valor inicial quando não controlado. Padrão do plano (§17): seguir o SO. */
  defaultPreference?: ThemePreference;
  /**
   * Persistência via callback/prop — o componente NUNCA toca em localStorage.
   * Disparado quando o usuário troca o tema dentro do provider.
   */
  onChange?: (preference: ThemePreference) => void;
  children: ReactNode;
}

function readSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

/**
 * Tema claro/escuro/manual/seguir o SO (§6).
 * Aplica `data-theme` no elemento raiz; tokens.css faz o resto.
 */
export function ThemeProvider({
  preference,
  defaultPreference = "system",
  onChange,
  children,
}: ThemeProviderProps) {
  const [internalPreference, setInternalPreference] =
    useState<ThemePreference>(defaultPreference);
  const activePreference = preference ?? internalPreference;
  const [systemDark, setSystemDark] = useState<boolean>(readSystemDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChangeMedia = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener("change", onChangeMedia);
    return () => query.removeEventListener("change", onChangeMedia);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(activePreference, systemDark),
    [activePreference, systemDark],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setInternalPreference(next);
      onChange?.(next);
    },
    [onChange],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference: activePreference,
      resolvedTheme,
      setPreference,
    }),
    [activePreference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
