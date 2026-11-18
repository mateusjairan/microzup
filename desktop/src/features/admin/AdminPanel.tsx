import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Archive,
  BarChart3,
  Building2,
  HardDrive,
  KeyRound,
  Pencil,
  Plus,
  Power,
  ScrollText,
  Search,
  Shield,
  Users,
  X,
} from "lucide-react";
import { Button, IconButton, Input } from "../../components/ui";
import { formatFileSize } from "../../components/utils/format";
import { useShortcutScope } from "../../app/ShortcutsProvider";
import { t } from "../../i18n/pt-BR";
import { api, ApiError } from "../../lib/api";
import type { AdminStats, AuditEntry, Role, Sector, User } from "../../types";
import type { components } from "../../types/api";

type Channel = components["schemas"]["ChannelOut"];
type Tab = "users" | "sectors" | "channels" | "audit" | "stats";

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "users", label: t.admin.tabs.users, icon: <Users size={16} /> },
  { id: "sectors", label: t.admin.tabs.sectors, icon: <Building2 size={16} /> },
  { id: "channels", label: t.admin.tabs.channels, icon: <Shield size={16} /> },
  { id: "audit", label: t.admin.tabs.audit, icon: <ScrollText size={16} /> },
  { id: "stats", label: t.admin.tabs.stats, icon: <BarChart3 size={16} /> },
];

const AUDIT_PAGE = 100;
const AUDIT_MAX = 500;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

async function fetchUsers(includeInactive: boolean): Promise<User[]> {
  const suffix = includeInactive ? "?include_inactive=true" : "";
  return api.get<User[]>(`/admin/users${suffix}`);
}

async function fetchSectors(): Promise<Sector[]> {
  return api.get<Sector[]>("/admin/sectors");
}

async function fetchChannels(): Promise<Channel[]> {
  return api.get<Channel[]>("/admin/channels");
}

async function fetchStats(): Promise<AdminStats> {
  return api.get<AdminStats>("/admin/stats");
}

async function fetchAudit(action: string, limit: number): Promise<AuditEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (action) params.set("action", action);
  return api.get<AuditEntry[]>(`/admin/audit?${params.toString()}`);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : t.admin.common.error;
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [auditFilter, setAuditFilter] = useState("");
  const [auditFilterInput, setAuditFilterInput] = useState("");
  const [auditLimit, setAuditLimit] = useState(AUDIT_PAGE);

  const [userModal, setUserModal] = useState<{ user: User | null } | null>(null);
  const [sectorModal, setSectorModal] = useState<{ sector: Sector | null } | null>(null);
  const [renameChannel, setRenameChannel] = useState<Channel | null>(null);
  const [confirmChannel, setConfirmChannel] = useState<Channel | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<User | null>(null);

  useShortcutScope(
    {
      close: () => {
        onClose();
        return true;
      },
    },
    { id: "admin-panel" },
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextUsers, nextAudit] = await Promise.all([
          fetchUsers(includeInactive),
          fetchAudit(auditFilter, auditLimit),
        ]);
        if (!cancelled) {
          setUsers(nextUsers);
          setAudit(nextAudit);
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [includeInactive, auditFilter, auditLimit]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextSectors, nextStats, nextChannels] = await Promise.all([
          fetchSectors(),
          fetchStats(),
          fetchChannels(),
        ]);
        if (!cancelled) {
          setSectors(nextSectors);
          setStats(nextStats);
          setChannels(nextChannels);
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [nextUsers, nextSectors, nextStats, nextAudit, nextChannels] = await Promise.all([
      fetchUsers(includeInactive),
      fetchSectors(),
      fetchStats(),
      fetchAudit(auditFilter, auditLimit),
      fetchChannels(),
    ]);
    setUsers(nextUsers);
    setSectors(nextSectors);
    setStats(nextStats);
    setAudit(nextAudit);
    setChannels(nextChannels);
  }, [includeInactive, auditFilter, auditLimit]);

  async function perform(action: () => Promise<unknown>, success: string): Promise<string | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setBusy(false);
      return errorMessage(err);
    }
    setNotice(success);
    try {
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
    return null;
  }

  function applyAuditFilter(event: FormEvent) {
    event.preventDefault();
    setAuditLimit(AUDIT_PAGE);
    setAuditFilter(auditFilterInput.trim());
  }

  function clearAuditFilter() {
    setAuditFilterInput("");
    setAuditFilter("");
    setAuditLimit(AUDIT_PAGE);
  }

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) =>
        user.username.toLowerCase().includes(term) ||
        user.display_name.toLowerCase().includes(term),
    );
  }, [users, search]);

  const sectorName = useCallback(
    (sectorId: string | null): string => {
      if (!sectorId) return t.admin.common.noSector;
      return sectors.find((sector) => sector.id === sectorId)?.name ?? t.admin.common.noSector;
    },
    [sectors],
  );

  const userName = useCallback(
    (userId: string | null): string => {
      if (!userId) return t.admin.audit.system;
      return users.find((user) => user.id === userId)?.display_name ?? userId;
    },
    [users],
  );

  async function saveUser(values: {
    username: string;
    displayName: string;
    password: string;
    role: Role;
    sectorId: string | null;
  }): Promise<string | null> {
    const editing = userModal?.user ?? null;
    const error =
      editing === null
        ? await perform(
            () =>
              api.post<User>("/admin/users", {
                username: values.username,
                display_name: values.displayName,
                password: values.password,
                role: values.role,
                sector_id: values.sectorId,
              }),
            t.admin.users.created,
          )
        : await perform(
            () =>
              api.patch<User>(`/admin/users/${editing.id}`, {
                role: values.role,
                sector_id: values.sectorId,
                clear_sector: values.sectorId === null,
              }),
            t.admin.users.updated,
          );

    if (error === null) setUserModal(null);
    return error;
  }

  async function saveSector(values: { name: string; description: string }): Promise<string | null> {
    const editing = sectorModal?.sector ?? null;
    const body = { name: values.name, description: values.description || null };
    const error =
      editing === null
        ? await perform(() => api.post<Sector>("/admin/sectors", body), t.admin.sectors.created)
        : await perform(
            () => api.patch<Sector>(`/admin/sectors/${editing.id}`, body),
            t.admin.sectors.updated,
          );

    if (error === null) setSectorModal(null);
    return error;
  }

  async function renameChannelTo(channel: Channel, name: string): Promise<string | null> {
    const error = await perform(
      () => api.patch<Channel>(`/admin/channels/${channel.id}`, { name }),
      t.admin.channels.updated,
    );
    if (error === null) setRenameChannel(null);
    return error;
  }

  async function toggleChannel(channel: Channel): Promise<string | null> {
    const archived = channel.archived_at !== null;
    const error = await perform(
      () => api.patch<Channel>(`/admin/channels/${channel.id}`, { archived: !archived }),
      t.admin.channels.updated,
    );
    if (error === null) setConfirmChannel(null);
    return error;
  }

  async function toggleUser(user: User): Promise<string | null> {
    const error = await perform(
      () => api.patch<User>(`/admin/users/${user.id}`, { is_active: !user.is_active }),
      t.admin.users.updated,
    );
    if (error === null) setConfirmTarget(null);
    return error;
  }

  async function resetPassword(user: User, newPassword: string): Promise<string | null> {
    const error = await perform(
      () => api.post<User>(`/admin/users/${user.id}/password`, { new_password: newPassword }),
      t.admin.users.passwordReset,
    );
    if (error === null) setResetTarget(null);
    return error;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-app)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-surface)] px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Shield size={18} strokeWidth={2} />
          </span>
          <div>
            <h1 className="text-[length:var(--fs-body)] font-semibold">{t.admin.title}</h1>
            <p className="text-[length:var(--fs-meta)] text-[var(--text-3)]">{t.admin.subtitle}</p>
          </div>
        </div>
        <IconButton onClick={onClose} label={t.admin.close}>
          <X size={18} strokeWidth={2} />
        </IconButton>
      </header>

      <nav
        role="tablist"
        aria-label={t.admin.title}
        className="flex shrink-0 gap-1 border-b border-[var(--border)] bg-[var(--bg-surface)] px-6"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            id={`admin-tab-${item.id}`}
            aria-controls={`admin-panel-${item.id}`}
            aria-selected={tab === item.id}
            onClick={() => {
              setTab(item.id);
              setNotice(null);
              setError(null);
            }}
            className={`tz-colors flex items-center gap-2 border-b-2 px-3 py-3 text-[length:var(--fs-body)] ${
              tab === item.id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-2)] hover:text-[var(--text)]"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div aria-live="polite" className="min-h-8 shrink-0 px-6 pt-2 text-[length:var(--fs-body)]">
        {error && <span className="text-[var(--danger)]">{error}</span>}
        {!error && notice && <span className="text-[var(--success-text)]">{notice}</span>}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-[length:var(--fs-body)] text-[var(--text-3)]">
          {t.admin.common.loading}
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`admin-panel-${tab}`}
          aria-labelledby={`admin-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col p-6 pt-2"
        >
          {tab === "users" && (
            <section className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t.admin.users.searchPlaceholder}
                    aria-label={t.admin.users.searchPlaceholder}
                    className="w-72"
                  />
                  <label className="flex items-center gap-2 text-[length:var(--fs-body)] text-[var(--text-2)]">
                    <input
                      type="checkbox"
                      checked={includeInactive}
                      onChange={(event) => setIncludeInactive(event.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {t.admin.users.includeInactive}
                  </label>
                </div>
                <Button onClick={() => setUserModal({ user: null })} disabled={busy} icon={<Plus size={16} strokeWidth={2} />}>
                  {t.admin.users.new}
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-[length:var(--fs-list)]">
                  <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[length:var(--fs-meta)] tracking-wide text-[var(--text-3)] uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.admin.users.displayName}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.users.username}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.users.role}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.users.sector}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.users.status}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.admin.users.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]">
                        <td className="px-4 py-3">{user.display_name}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{user.username}</td>
                        <td className="px-4 py-3">{t.admin.users.roles[user.role]}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{sectorName(user.sector_id)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-[var(--radius-full)] px-2 py-0.5 text-[length:var(--fs-meta)] ${
                              user.is_active
                                ? "bg-[var(--accent-soft)] text-[var(--success-text)]"
                                : "bg-[var(--bg-hover)] text-[var(--text-3)]"
                            }`}
                          >
                            {user.is_active ? t.admin.users.active : t.admin.users.inactive}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            <IconButton
                              onClick={() => setUserModal({ user })}
                              label={`${t.admin.common.edit}: ${user.display_name}`}
                            >
                              <Pencil size={15} strokeWidth={2} />
                            </IconButton>
                            <IconButton
                              onClick={() => setResetTarget(user)}
                              label={`${t.admin.users.resetPassword}: ${user.display_name}`}
                            >
                              <KeyRound size={15} strokeWidth={2} />
                            </IconButton>
                            <IconButton
                              onClick={() => setConfirmTarget(user)}
                              label={`${user.is_active ? t.admin.users.deactivate : t.admin.users.activate}: ${user.display_name}`}
                            >
                              <Power size={15} strokeWidth={2} />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <p className="p-6 text-center text-[length:var(--fs-body)] text-[var(--text-3)]">
                    {t.admin.users.empty}
                  </p>
                )}
              </div>
            </section>
          )}

          {tab === "sectors" && (
            <section className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[length:var(--fs-body)] font-semibold">{t.admin.tabs.sectors}</h2>
                <Button onClick={() => setSectorModal({ sector: null })} disabled={busy} icon={<Plus size={16} strokeWidth={2} />}>
                  {t.admin.sectors.new}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-[length:var(--fs-list)]">
                  <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[length:var(--fs-meta)] tracking-wide text-[var(--text-3)] uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.admin.sectors.name}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.sectors.slug}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.sectors.description}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.admin.users.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectors.map((sector) => (
                      <tr key={sector.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]">
                        <td className="px-4 py-3">{sector.name}</td>
                        <td className="px-4 py-3 font-mono text-[length:var(--fs-meta)] text-[var(--text-3)]">
                          {sector.slug}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{sector.description ?? "—"}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end">
                            <IconButton
                              onClick={() => setSectorModal({ sector })}
                              label={`${t.admin.common.edit}: ${sector.name}`}
                            >
                              <Pencil size={15} strokeWidth={2} />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sectors.length === 0 && (
                  <p className="p-6 text-center text-[length:var(--fs-body)] text-[var(--text-3)]">
                    {t.admin.sectors.empty}
                  </p>
                )}
              </div>
            </section>
          )}

          {tab === "channels" && (
            <section className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[length:var(--fs-body)] font-semibold">{t.admin.tabs.channels}</h2>
                <Button
                  variant="secondary"
                  onClick={() => void refresh()}
                  disabled={busy}
                  aria-label={t.admin.common.refresh}
                >
                  {t.admin.common.refresh}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-[length:var(--fs-list)]">
                  <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[length:var(--fs-meta)] tracking-wide text-[var(--text-3)] uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.admin.channels.name}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.channels.sector}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.channels.members}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.users.status}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.admin.users.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.map((channel) => (
                      <tr key={channel.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]">
                        <td className="px-4 py-3">{channel.name ?? "—"}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{channel.sector_name ?? sectorName(channel.sector_id)}</td>
                        <td className="nums-tabular px-4 py-3 text-[var(--text-2)]">{channel.member_count}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-[var(--radius-full)] px-2 py-0.5 text-[length:var(--fs-meta)] ${
                              channel.archived_at === null
                                ? "bg-[var(--accent-soft)] text-[var(--success-text)]"
                                : "bg-[var(--bg-hover)] text-[var(--text-3)]"
                            }`}
                          >
                            {channel.archived_at === null ? t.admin.users.active : t.admin.channels.archived}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            <IconButton
                              onClick={() => setRenameChannel(channel)}
                              label={`${t.admin.channels.rename}: ${channel.name ?? ""}`}
                            >
                              <Pencil size={15} strokeWidth={2} />
                            </IconButton>
                            <IconButton
                              onClick={() => setConfirmChannel(channel)}
                              label={`${channel.archived_at === null ? t.admin.channels.archive : t.admin.channels.unarchive}: ${channel.name ?? ""}`}
                            >
                              {channel.archived_at === null ? (
                                <Archive size={15} strokeWidth={2} />
                              ) : (
                                <Power size={15} strokeWidth={2} />
                              )}
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {channels.length === 0 && (
                  <p className="p-6 text-center text-[length:var(--fs-body)] text-[var(--text-3)]">
                    {t.admin.channels.empty}
                  </p>
                )}
              </div>
            </section>
          )}

          {tab === "audit" && (
            <section className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[length:var(--fs-body)] text-[var(--text-3)]">{t.admin.audit.hint}</p>
                <form onSubmit={applyAuditFilter} className="flex items-center gap-2">
                  <Input
                    value={auditFilterInput}
                    onChange={(event) => setAuditFilterInput(event.target.value)}
                    placeholder={t.admin.audit.filterPlaceholder}
                    aria-label={t.admin.audit.filterPlaceholder}
                    className="w-72"
                  />
                  <Button type="submit" variant="ghost" icon={<Search size={15} strokeWidth={2} />}>
                    {t.admin.audit.applyFilter}
                  </Button>
                  {auditFilter && (
                    <Button type="button" variant="ghost" onClick={clearAuditFilter}>
                      {t.admin.audit.clearFilter}
                    </Button>
                  )}
                </form>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-[length:var(--fs-list)]">
                  <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[length:var(--fs-meta)] tracking-wide text-[var(--text-3)] uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.admin.audit.when}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.audit.action}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.audit.actor}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.audit.entity}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.audit.ip}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id} className="border-t border-[var(--border)]">
                        <td className="whitespace-nowrap px-4 py-2 text-[var(--text-2)]">
                          {formatDate(entry.created_at)}
                        </td>
                        <td className="px-4 py-2 font-mono text-[length:var(--fs-meta)]">{entry.action}</td>
                        <td className="px-4 py-2 text-[var(--text-2)]">{userName(entry.actor_id)}</td>
                        <td className="px-4 py-2 text-[var(--text-3)]">
                          {entry.entity_type}
                          {entry.entity_id ? `:${entry.entity_id.slice(0, 8)}` : ""}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-3)]">{entry.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {audit.length === 0 && (
                  <p className="p-6 text-center text-[length:var(--fs-body)] text-[var(--text-3)]">
                    {t.admin.audit.empty}
                  </p>
                )}
              </div>
              {audit.length >= auditLimit && auditLimit < AUDIT_MAX && (
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    onClick={() => setAuditLimit((value) => Math.min(value + AUDIT_PAGE, AUDIT_MAX))}
                  >
                    {t.admin.audit.loadMore}
                  </Button>
                </div>
              )}
            </section>
          )}

          {tab === "stats" && (
            <section className="flex flex-col gap-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
                <StatCard label={t.admin.stats.users} value={formatCount(stats?.users)} />
                <StatCard label={t.admin.stats.sectors} value={formatCount(stats?.sectors)} />
                <StatCard label={t.admin.stats.conversations} value={formatCount(stats?.conversations)} />
                <StatCard label={t.admin.stats.messages} value={formatCount(stats?.messages)} />
                <StatCard label={t.admin.stats.attachments} value={formatCount(stats?.attachments)} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <StorageCard
                  label={t.admin.stats.storage}
                  value={formatFileSize(stats?.storage_bytes ?? 0, t.format.units)}
                  hint={`${t.admin.stats.storageFiles}: ${formatCount(stats?.storage_files)}`}
                />
                <StorageCard
                  label={t.admin.stats.diskFree}
                  value={`${formatFileSize(stats?.disk_free_bytes ?? 0, t.format.units)} / ${formatFileSize(stats?.disk_total_bytes ?? 0, t.format.units)}`}
                  barPercent={diskPercent(stats)}
                  icon={<HardDrive size={16} strokeWidth={2} />}
                />
              </div>
            </section>
          )}
        </div>
      )}

      {userModal && (
        <UserFormModal
          user={userModal.user}
          sectors={sectors}
          busy={busy}
          onCancel={() => setUserModal(null)}
          onSubmit={saveUser}
        />
      )}
      {sectorModal && (
        <SectorFormModal
          sector={sectorModal.sector}
          busy={busy}
          onCancel={() => setSectorModal(null)}
          onSubmit={saveSector}
        />
      )}
      {renameChannel !== null && (
        <ChannelNameModal
          channel={renameChannel}
          busy={busy}
          onCancel={() => setRenameChannel(null)}
          onSubmit={(name) => renameChannelTo(renameChannel, name)}
        />
      )}
      {confirmChannel !== null && (
        <ConfirmModal
          title={confirmChannel.archived_at === null ? t.admin.channels.archive : t.admin.channels.unarchive}
          message={
            confirmChannel.archived_at === null
              ? t.admin.channels.confirmArchive
              : t.admin.channels.confirmUnarchive
          }
          confirmLabel={confirmChannel.archived_at === null ? t.admin.channels.archive : t.admin.channels.unarchive}
          busy={busy}
          onCancel={() => setConfirmChannel(null)}
          onConfirm={() => toggleChannel(confirmChannel)}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          busy={busy}
          onCancel={() => setResetTarget(null)}
          onSubmit={(password) => resetPassword(resetTarget, password)}
        />
      )}
      {confirmTarget && (
        <ConfirmModal
          title={confirmTarget.is_active ? t.admin.users.deactivate : t.admin.users.activate}
          message={
            confirmTarget.is_active
              ? t.admin.users.confirmDeactivate
              : t.admin.users.confirmActivate
          }
          confirmLabel={confirmTarget.is_active ? t.admin.users.deactivate : t.admin.users.activate}
          busy={busy}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => toggleUser(confirmTarget)}
        />
      )}
    </div>
  );
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

function diskPercent(stats: AdminStats | null): number {
  if (stats === null || stats.disk_total_bytes <= 0) return 0;
  const used = stats.disk_total_bytes - stats.disk_free_bytes;
  return Math.max(0, Math.min(100, Math.round((used / stats.disk_total_bytes) * 100)));
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="text-[length:var(--fs-meta)] tracking-wide text-[var(--text-3)] uppercase">{label}</div>
      <div className="nums-tabular mt-2 text-2xl font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function StorageCard({
  label,
  value,
  hint,
  barPercent,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  barPercent?: number;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center gap-2 text-[length:var(--fs-meta)] tracking-wide text-[var(--text-3)] uppercase">
        {icon}
        {label}
      </div>
      <div className="nums-tabular mt-2 text-[length:var(--fs-title)] font-semibold text-[var(--text)]">
        {value}
      </div>
      {hint && <div className="mt-1 text-[length:var(--fs-meta)] text-[var(--text-3)]">{hint}</div>}
      {barPercent !== undefined && (
        <div
          role="progressbar"
          aria-valuenow={barPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
          className="mt-3 h-2 w-full overflow-hidden rounded-[var(--radius-full)] bg-[var(--border)]"
        >
          <div
            className={`h-full rounded-[var(--radius-full)] ${barPercent > 90 ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="m-auto w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text)] shadow-[var(--shadow-3)] backdrop:bg-[rgba(15,19,25,0.4)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <h2 className="text-[length:var(--fs-body)] font-semibold">{title}</h2>
        <IconButton onClick={onCancel} label={t.admin.common.cancel}>
          <X size={16} strokeWidth={2} />
        </IconButton>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-[length:var(--fs-body)]">
      <span className="mb-1 block text-[var(--text-2)]">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[length:var(--fs-body)] text-[var(--text)] outline-none"
    >
      {children}
    </select>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-3 text-[length:var(--fs-body)] text-[var(--danger)]">
      {message}
    </p>
  );
}

function UserFormModal({
  user,
  sectors,
  busy,
  onCancel,
  onSubmit,
}: {
  user: User | null;
  sectors: Sector[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    username: string;
    displayName: string;
    password: string;
    role: Role;
    sectorId: string | null;
  }) => Promise<string | null>;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "member");
  const [sectorId, setSectorId] = useState(user?.sector_id ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (password.length > 0 && password.length < 8) {
      setFormError(t.admin.users.passwordTooShort);
      return;
    }
    const error = await onSubmit({
      username,
      displayName,
      password,
      role,
      sectorId: sectorId || null,
    });
    if (error) setFormError(error);
  }

  return (
    <Modal title={user ? t.admin.users.editTitle : t.admin.users.createTitle} onCancel={onCancel}>
      <form onSubmit={submit}>
        <FormError message={formError} />
        <Field label={t.admin.users.username}>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={3}
            maxLength={32}
            autoComplete="off"
            disabled={user !== null}
          />
        </Field>
        <Field label={t.admin.users.displayName}>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
          />
        </Field>
        {user === null && (
          <Field label={t.admin.users.password}>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
        )}
        <Field label={t.admin.users.role}>
          <Select
            value={role}
            onChange={(value) => setRole(value === "admin" ? "admin" : "member")}
            ariaLabel={t.admin.users.role}
          >
            <option value="member">{t.admin.users.roles.member}</option>
            <option value="admin">{t.admin.users.roles.admin}</option>
          </Select>
        </Field>
        <Field label={t.admin.users.sector}>
          <Select value={sectorId} onChange={setSectorId} ariaLabel={t.admin.users.sector}>
            <option value="">{t.admin.common.noSector}</option>
            {sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.admin.common.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {user ? t.admin.common.save : t.admin.common.create}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SectorFormModal({
  sector,
  busy,
  onCancel,
  onSubmit,
}: {
  sector: Sector | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; description: string }) => Promise<string | null>;
}) {
  const [name, setName] = useState(sector?.name ?? "");
  const [description, setDescription] = useState(sector?.description ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const error = await onSubmit({ name, description });
    if (error) setFormError(error);
  }

  return (
    <Modal title={sector ? t.admin.sectors.editTitle : t.admin.sectors.createTitle} onCancel={onCancel}>
      <form onSubmit={submit}>
        <FormError message={formError} />
        <Field label={t.admin.sectors.name}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <Field label={t.admin.sectors.description}>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            autoComplete="off"
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.admin.common.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {sector ? t.admin.common.save : t.admin.common.create}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ChannelNameModal({
  channel,
  busy,
  onCancel,
  onSubmit,
}: {
  channel: Channel;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(channel.name ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const error = await onSubmit(name.trim());
    if (error) setFormError(error);
  }

  return (
    <Modal title={t.admin.channels.renameTitle} onCancel={onCancel}>
      <form onSubmit={submit}>
        <FormError message={formError} />
        <Field label={t.admin.channels.name}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.admin.common.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {t.admin.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  busy,
  onCancel,
  onSubmit,
}: {
  user: User;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (password.length < 8) {
      setFormError(t.admin.users.passwordTooShort);
      return;
    }
    if (password !== confirmation) {
      setFormError(t.admin.users.passwordMismatch);
      return;
    }
    const error = await onSubmit(password);
    if (error) setFormError(error);
  }

  return (
    <Modal title={`${t.admin.users.resetTitle} · ${user.display_name}`} onCancel={onCancel}>
      <form onSubmit={submit}>
        <p className="mb-3 text-[length:var(--fs-body)] text-[var(--text-2)]">{t.admin.users.resetHint}</p>
        <FormError message={formError} />
        <Field label={t.admin.users.newPassword}>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <Field label={t.admin.users.confirmPassword}>
          <Input
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.admin.common.cancel}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {t.admin.users.resetPassword}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [formError, setFormError] = useState<string | null>(null);

  async function confirm() {
    setFormError(null);
    const error = await onConfirm();
    if (error) setFormError(error);
  }

  return (
    <Modal title={title} onCancel={onCancel}>
      <FormError message={formError} />
      <p className="text-[length:var(--fs-body)] text-[var(--text-2)]">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t.admin.common.cancel}
        </Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
