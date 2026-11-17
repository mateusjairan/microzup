import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { api } from "../lib/api";
import { setServerUrl, getServerUrl } from "../lib/bridge";
import { setTokens } from "../lib/api";
import { Button, Input, Spinner } from "../components/ui";
import { t } from "../i18n/pt-BR";
import { useApp } from "../store";
import type { LoginResponse } from "../types";

export function Login() {
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const setUser = useApp((s) => s.setUser);

  useState(() => {
    void getServerUrl().then((url) => setServer(url));
  });

  async function testConnection() {
    setTesting(true);
    setConnectionStatus(null);
    try {
      const response = await fetch(`${server}/health`);
      setConnectionStatus(response.ok ? t.login.connectionOk : t.login.connectionFail);
    } catch {
      setConnectionStatus(t.login.connectionFail);
    } finally {
      setTesting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!server.trim()) {
      setError(t.login.requiredServer);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setServerUrl(server.trim().replace(/\/$/, ""));
      const result = await api.post<LoginResponse>("/auth/login", {
        username,
        password,
        device_name: "desktop",
      });
      await setTokens({ access: result.access_token, refresh: result.refresh_token });
      setUser(result.user);
    } catch (err) {
      const message =
        err instanceof Error && "status" in err && (err as { status?: number }).status === 403
          ? t.login.inactive
          : t.login.invalidCredentials;
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--bg-app)] p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-8 shadow-sm"
      >
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <MessageCircle size={24} />
          </div>
          <h1 className="text-xl font-semibold">{t.appName}</h1>
          <p className="text-sm text-[var(--text-3)]">{t.tagline}</p>
        </div>

        <label className="mb-1 block text-sm text-[var(--text-2)]">{t.login.server}</label>
        <div className="mb-4 flex gap-2">
          <Input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://192.168.0.10:8000"
          />
          <Button type="button" variant="ghost" onClick={testConnection} disabled={testing}>
            {testing ? <Spinner /> : t.login.testConnection}
          </Button>
        </div>
        {connectionStatus && (
          <p className="mb-4 text-xs text-[var(--text-3)]">{connectionStatus}</p>
        )}

        <label className="mb-1 block text-sm text-[var(--text-2)]">{t.login.username}</label>
        <Input
          className="mb-4"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />

        <label className="mb-1 block text-sm text-[var(--text-2)]">{t.login.password}</label>
        <Input
          className="mb-6"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && <p className="mb-4 text-sm text-[var(--danger)]">{error}</p>}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : t.login.submit}
        </Button>
      </form>
    </div>
  );
}
