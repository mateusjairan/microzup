import { createContext, useContext, type ReactNode } from "react";
import { t as ptBRDict } from "../i18n/pt-BR";

export type I18nDict = typeof ptBRDict;

const I18nContext = createContext<I18nDict>(ptBRDict);

export interface I18nProviderProps {
  /** Dicionário sobrescrevível (injeta variantes em testes/stories). */
  dict?: I18nDict;
  children: ReactNode;
}

export function I18nProvider({ dict = ptBRDict, children }: I18nProviderProps) {
  return <I18nContext.Provider value={dict}>{children}</I18nContext.Provider>;
}

/** Todas as strings visíveis saem daqui — componente não tem texto próprio. */
export function useI18n(): I18nDict {
  return useContext(I18nContext);
}
