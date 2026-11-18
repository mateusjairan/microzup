import type { ReactNode } from "react";
import { Monitor, Moon, SunMedium } from "lucide-react";
import { useI18n } from "../../app/I18nProvider";
import { useTheme, type ThemePreference } from "../../app/ThemeProvider";
import { Dialog } from "../../components/ui";
import { Switch } from "../../components/ui";
import { Button } from "../../components/ui";
import { useApp } from "../../store";
import type { AppPreferences } from "../../../electron/ipc-contract";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  prefs: AppPreferences;
  onPrefsChange: (patch: Partial<AppPreferences>) => void;
}

const LOCK_OPTIONS = [0, 5, 10, 15, 30] as const;
const AUTO_AWAY_OPTIONS = [5, 10, 15, 30] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[length:var(--fs-meta)] font-semibold tracking-wide text-[var(--text-3)] uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[length:var(--fs-body)] text-[var(--text)]">{label}</span>
        {hint !== undefined && (
          <span className="block text-[length:var(--fs-meta)] text-[var(--text-3)]">{hint}</span>
        )}
      </span>
      <span className="shrink-0">{control}</span>
    </div>
  );
}

/** Configurações (§5): perfil de aparência, notificações, sessão, comportamento. */
export function SettingsDialog({ open, onClose, prefs, onPrefsChange }: SettingsDialogProps) {
  const t = useI18n();
  const { preference, setPreference } = useTheme();
  const serverVersion = useApp((state) => state.serverVersion);
  const appVersion = useApp((state) => state.appVersion);
  const versionNotice = useApp((state) => state.serverVersionNotice);
  const ackServerVersion = useApp((state) => state.ackServerVersion);

  const themeButtons: Array<{ value: ThemePreference; label: string; icon: ReactNode }> = [
    { value: "light", label: t.ui.theme.light, icon: <SunMedium size={14} strokeWidth={2} /> },
    { value: "dark", label: t.ui.theme.dark, icon: <Moon size={14} strokeWidth={2} /> },
    { value: "system", label: t.ui.theme.system, icon: <Monitor size={14} strokeWidth={2} /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={t.settings.title}>
      <Section title={t.settings.appearance}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t.settings.appearance}>
          {themeButtons.map((option) => (
            <Button
              key={option.value}
              variant={preference === option.value ? "primary" : "secondary"}
              size="sm"
              icon={option.icon}
              aria-pressed={preference === option.value}
              onClick={() => {
                setPreference(option.value);
                onPrefsChange({ theme: option.value });
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title={t.settings.notifications}>
        <Row
          label={t.settings.sounds}
          hint={t.settings.soundsHint}
          control={
            <Switch
              checked={prefs.soundsEnabled}
              onCheckedChange={(checked) => onPrefsChange({ soundsEnabled: checked })}
              label={t.settings.sounds}
            />
          }
        />
      </Section>

      <Section title={t.settings.session}>
        <Row
          label={t.settings.lockTimeout}
          control={
            <select
              value={String(prefs.lockTimeoutMinutes)}
              onChange={(event) => onPrefsChange({ lockTimeoutMinutes: Number(event.target.value) })}
              aria-label={t.settings.lockTimeout}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-[length:var(--fs-list)] text-[var(--text)] outline-none"
            >
              {LOCK_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? t.settings.lockTimeoutOff : `${minutes} min`}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title={t.settings.behavior}>
        <Row
          label={t.settings.closeToTray}
          control={
            <Switch
              checked={prefs.closeToTray}
              onCheckedChange={(checked) => onPrefsChange({ closeToTray: checked })}
              label={t.settings.closeToTray}
            />
          }
        />
        <Row
          label={t.settings.autoAway}
          control={
            <select
              value={String(prefs.autoAwayMinutes)}
              onChange={(event) => onPrefsChange({ autoAwayMinutes: Number(event.target.value) })}
              aria-label={t.settings.autoAway}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-[length:var(--fs-list)] text-[var(--text)] outline-none"
            >
              {AUTO_AWAY_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title={t.settings.about}>
        <Row
          label={t.settings.appVersion}
          control={<span className="nums-tabular text-[length:var(--fs-list)] text-[var(--text-2)]">{appVersion ?? "—"}</span>}
        />
        <Row
          label={t.settings.serverVersion}
          control={
            <span className="flex items-center gap-2">
              <span className="nums-tabular text-[length:var(--fs-list)] text-[var(--text-2)]">
                {serverVersion ?? "—"}
              </span>
              {versionNotice && (
                <Button size="sm" variant="secondary" onClick={ackServerVersion}>
                  {t.serverUpdate.dismiss}
                </Button>
              )}
            </span>
          }
        />
        {versionNotice && (
          <p role="status" className="text-[length:var(--fs-meta)] text-[var(--warning)]">
            {t.settings.newServerVersion} {t.serverUpdate.banner}
          </p>
        )}
      </Section>
    </Dialog>
  );
}
