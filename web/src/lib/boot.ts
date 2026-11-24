/**
 * Bootstrap do aplicativo e reautenticação.
 *
 * bootApp(): executa UMA vez na montagem — tenta o refresh silencioso (o cookie
 * HttpOnly diz se há sessão), busca /me, preferências, hidrata a fila de envio
 * persistida e aquece conversas/usuários. Devolve o usuário logado ou null
 * (UI mostra login).
 *
 * reauthenticate(password): reautentica após bloqueio/sessão expirada SEM
 * descartar o estado do renderer (rascunhos e mensagens permanecem).
 */
import { clear, endpoints, initAuth, setAccessToken } from "./api";
import { getPreferences } from "./platform";
import { readOutbox } from "./outbox";
import { useApp } from "../store";
import { restartRealtime, startRealtime } from "./realtime";
import type { User } from "../types";

export interface BootResult {
  user: User | null;
}

export async function bootApp(): Promise<BootResult> {
  const store = useApp.getState();

  // Versão do app = versão do servidor: o SPA é o artefato servido por ele.
  void endpoints
    .health()
    .then((health) => useApp.getState().setAppVersion(health.version))
    .catch(() => undefined);

  const authenticated = await initAuth();
  if (!authenticated) {
    return { user: null };
  }

  let me: User;
  try {
    me = await endpoints.me();
  } catch {
    // refresh aceito mas /me falhou (servidor sumiu?) — mantém login local
    // e deixa o fluxo de reconexão agir.
    return { user: null };
  }

  store.setUser(me);

  const preferences = getPreferences();
  store.setMutedConversations(preferences.mutedConversations);
  store.setLastServerVersion(preferences.lastServerVersion);

  // Fila de envio que ficou no navegador (offline/falha) volta como "failed"
  // e é reenviada quando a conexão estabelecer.
  const entries = await readOutbox();
  store.hydrateOutbox(entries);

  // Aquece conversas e diretório antes do WS para títulos/nomes imediatos.
  try {
    const conversations = await endpoints.listConversations();
    store.setConversations(conversations);
  } catch {
    /* catch-up na primeira conexão cobre */
  }
  try {
    const users = await endpoints.listDirectoryUsers();
    store.setUsers(users);
  } catch {
    /* idem */
  }

  startRealtime();
  return { user: me };
}

/** Reautentica com a senha (usuário atual) — usado no overlay de bloqueio. */
export async function reauthenticate(password: string): Promise<boolean> {
  const username = useApp.getState().user?.username;
  if (username === undefined || username === "") return false;
  try {
    const result = await endpoints.login({
      username,
      password,
      device_name: "web",
      remember: true,
    });
    setAccessToken(result.access_token);
    const store = useApp.getState();
    store.setUser(result.user);
    store.setSessionExpired(false);
    store.setSessionLocked(false);
    restartRealtime();
    return true;
  } catch {
    return false;
  }
}

/** Encerra a sessão do usuário (logout) mantendo rascunhos. */
export async function logout(): Promise<void> {
  const store = useApp.getState();
  store.reset();
  await clear();
}
