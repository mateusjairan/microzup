import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { reauthenticate } from "../../lib/boot";
import { useI18n } from "../../app/I18nProvider";
import { interpolate } from "../../components/utils/format";
import { Button, Input } from "../../components/ui";
import { useApp } from "../../store";

/**
 * Overlays de sessão (§5/§9): expirada e bloqueada por inatividade.
 * Reautentica SEM destruir o renderer — rascunhos e mensagens permanecem
 * (lib/boot.reauthenticate preserva o estado; nada de reset aqui).
 */
export function ReauthOverlay() {
  const expired = useApp((state) => state.sessionExpired);
  const locked = useApp((state) => state.sessionLocked);
  if (!expired && !locked) return null;
  return <Overlay mode={expired ? "expired" : "locked"} />;
}

function Overlay({ mode }: { mode: "expired" | "locked" }) {
  const t = useI18n();
  const username = useApp((state) => state.user?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = mode === "expired" ? t.reauth.expiredTitle : t.reauth.lockedTitle;
  const body = mode === "expired" ? t.reauth.expiredBody : t.reauth.lockedBody;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await reauthenticate(password);
    if (!ok) {
      setError(t.reauth.invalid);
      setBusy(false);
      setPassword("");
      return;
    }
    setBusy(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--overlay-heavy)] p-6"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8 shadow-[var(--shadow-3)]"
        style={{ animation: "mz-fade-in var(--motion-modal) var(--ease) both" }}
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-full)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Lock size={22} strokeWidth={2} />
          </span>
          <h2 className="text-[length:var(--fs-panel)] font-semibold leading-[var(--lh-title)] text-[var(--text)]">
            {title}
          </h2>
          <p className="text-[length:var(--fs-list)] leading-[var(--lh-body)] text-[var(--text-2)]">{body}</p>
        </div>

        <label htmlFor="reauth-password" className="mb-1 block text-[length:var(--fs-list)] text-[var(--text-2)]">
          {interpolate(t.reauth.passwordLabel, { username })}
        </label>
        <Input
          id="reauth-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          className="mb-4"
        />

        {error && (
          <p role="alert" className="mb-4 text-[length:var(--fs-body)] text-[var(--danger)]">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={busy}>
          {t.reauth.submit}
        </Button>
      </form>
    </div>
  );
}
