/**
 * Bootstrap do aplicativo e reautenticação.
 *
 * bootApp(): executa UMA vez na montagem — carrega sessão (safeStorage via
 * bridge), faz o refresh silencioso, busca /me, preferências, hidrata a fila
 * de envio persistida e aquece conversas/usuários. Devolve o usuário logado
 * ou null (UI mostra login).
 *
 * reauthenticate(password): reautentica após bloqueio/sessão expirada SEM
 * descartar o estado do renderer (rascunhos e mensagens permanecem).
 */
import { clear, endpoints, initAuth, isSessionOnly, setTokens } from "./api";
import { getAppVersion, getPreferences } from "./bridge";
import { readOutbox } from "./outbox";
import { useApp } from "../store";
import { restartRealtime, startRealtime } from "./realtime";
import type { User } from "../types";

export interface BootResult {
  user: User | null;
}

export async function bootApp(): Promise<BootResult> {
  const store = useApp.getState();

  void getAppVersion().then((version) => useApp.getState().setAppVersion(version));

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

  const preferences = await getPreferences();
  store.setMutedConversations(preferences.mutedConversations);
  store.setLastServerVersion(preferences.lastServerVersion);

  // Fila de envio que ficou no disco (offline/falha) volta como "failed"
  // e é reenviada quando a conexão estabelecer.
  const entries = await readOutbox();
  store.hydrateOutbox(entries);

  // Janela destacada de conversa (?conversation=<id> na URL).
  const fromUrl = new URLSearchParams(window.location.search).get("conversation");
  if (fromUrl !== null && fromUrl !== "") {
    store.setActiveConversation(fromUrl);
  }

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
    const result = await endpoints.login({ username, password, device_name: "desktop" });
    // Preserva a escolha de "manter conectado" do login original.
    await setTokens(
      { access: result.access_token, refresh: result.refresh_token },
      { sessionOnly: isSessionOnly() },
    );
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
