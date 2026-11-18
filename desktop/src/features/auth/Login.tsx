import { useEffect, useState, type FormEvent } from "react";
import { MessageCircle } from "lucide-react";
import { endpoints, setTokens, ApiError } from "../../lib/api";
import { getServerUrl, setServerUrl } from "../../lib/bridge";
import { useI18n } from "../../app/I18nProvider";
import { Button, Input } from "../../components/ui";
import { useApp } from "../../store";

/**
 * Login / primeira execução (§4/§5/§9): servidor OBRIGATÓRIO (não há
 * descoberta automática no MVP), teste de conexão em /health, estados
 * carregando/credencial inválida/servidor inacessível/bloqueio por tentativas.
 */
export function Login() {
  const t = useI18n();
  const setUser = useApp((state) => state.setUser);
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keepConnected, setKeepConnected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  useEffect(() => {
    void getServerUrl().then((url) => setServer(url));
  }, []);

  async function testConnection() {
    setTesting(true);
    setConnectionStatus(null);
    try {
      const response = await fetch(`${server.trim().replace(/\/$/, "")}/health`);
      setConnectionStatus(response.ok ? t.login.connectionOk : t.login.connectionFail);
    } catch {
      setConnectionStatus(t.login.connectionFail);
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!server.trim()) {
      setError(t.login.requiredServer);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = server.trim().replace(/\/$/, "");
      await setServerUrl(base);
      const result = await endpoints.login({
        username,
        password,
        device_name: "desktop",
      });
      // "Manter conectado" desmarcado = sessão só em memória: o refresh NUNCA
      // toca o disco (nem agora, nem em rotações futuras — lib/api cuida).
      await setTokens(
        { access: result.access_token, refresh: result.refresh_token },
        { sessionOnly: !keepConnected },
      );
      setUser(result.user);
      // Aquece a lista (o bootApp não roda de novo no login manual).
      void endpoints
        .listConversations()
        .then((conversations) => useApp.getState().setConversations(conversations))
        .catch(() => undefined);
      void endpoints
        .listDirectoryUsers()
        .then((users) => useApp.getState().setUsers(users))
        .catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "inactive_user") setError(t.login.inactive);
        // 429 vem de DUAS fontes: bloqueio progressivo por IP+usuário
        // (too_many_attempts) e limite de 10/min por IP (rate_limited).
        // Sem esse mapeamento, o limite por IP aparecia como "credencial
        // inválida" — mensagem enganosa (regra §5: estado "bloqueado por
        // tentativas" explícito).
        else if (err.code === "too_many_attempts" || err.code === "rate_limited")
          setError(t.login.blocked);
        else setError(t.login.invalidCredentials);
      } else {
        setError(t.login.connectionFail);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--bg-app)] p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8 shadow-[var(--shadow-1)]"
      >
        <div className="mb-8 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-white">
            <MessageCircle size={24} strokeWidth={2} />
          </span>
          <h1 className="text-[length:var(--fs-display)] font-semibold leading-[var(--lh-title)] text-[var(--text)]">
            {t.appName}
          </h1>
          <p className="text-[length:var(--fs-list)] text-[var(--text-3)]">{t.tagline}</p>
        </div>

        <label htmlFor="login-server" className="mb-1 block text-[length:var(--fs-list)] text-[var(--text-2)]">
          {t.login.server}
        </label>
        <div className="mb-2 flex gap-2">
          <Input
            id="login-server"
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder="http://192.168.0.10:8666"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="button" variant="secondary" loading={testing} onClick={() => void testConnection()}>
            {t.login.testConnection}
          </Button>
        </div>
        {connectionStatus && (
          <p
            role="status"
            className={`mb-4 text-[length:var(--fs-meta)] ${connectionStatus === t.login.connectionOk ? "text-[var(--success-text)]" : "text-[var(--danger)]"}`}
          >
            {connectionStatus}
          </p>
        )}

        <label htmlFor="login-username" className="mb-1 block text-[length:var(--fs-list)] text-[var(--text-2)]">
          {t.login.username}
        </label>
        <Input
          id="login-username"
          className="mb-4"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="login-password" className="mb-1 block text-[length:var(--fs-list)] text-[var(--text-2)]">
          {t.login.password}
        </label>
        <Input
          id="login-password"
          className="mb-4"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />

        <label className="mb-6 flex items-center gap-2 text-[length:var(--fs-list)] text-[var(--text-2)]">
          <input
            type="checkbox"
            checked={keepConnected}
            onChange={(event) => setKeepConnected(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          {t.login.keepConnected}
        </label>

        {error && (
          <p role="alert" className="mb-4 text-[length:var(--fs-body)] text-[var(--danger)]">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={busy}>
          {t.login.submit}
        </Button>
      </form>
    </div>
  );
}
