import { useState, type FormEvent } from "react";
import { MessageCircle } from "lucide-react";
import { endpoints, setAccessToken, ApiError } from "../../lib/api";
import { requestNotificationPermission } from "../../lib/platform";
import { useI18n } from "../../app/I18nProvider";
import { Button, Input } from "../../components/ui";
import { useApp } from "../../store";

/**
 * Login (§4/§5/§9). No cliente web o endereço do servidor não é configurável:
 * a página é servida pelo próprio backend, então o login já fala com a mesma
 * origem. Estados: carregando / credencial inválida / bloqueio por tentativas.
 */
export function Login() {
  const t = useI18n();
  const setUser = useApp((state) => state.setUser);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keepConnected, setKeepConnected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await endpoints.login({
        username,
        password,
        device_name: "web",
        // Cookie persistente (30 dias) ou cookie de sessão do navegador.
        remember: keepConnected,
      });
      setAccessToken(result.access_token);
      setUser(result.user);
      // Pedido de permissão aproveita o gesto do clique no "Entrar".
      void requestNotificationPermission();
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
