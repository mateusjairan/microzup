import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  LogOut,
  Minus,
  PanelLeft,
  Search,
  Settings,
  Shield,
  Square,
  X,
} from "lucide-react";
import { useI18n } from "./app/I18nProvider";
import { I18nProvider } from "./app/I18nProvider";
import { ShortcutsProvider, useShortcutScope, type ShortcutHandlers } from "./app/ShortcutsProvider";
import { ThemeProvider, type ThemePreference } from "./app/ThemeProvider";
import { ToastProvider } from "./app/ToastProvider";
import { Avatar, IconButton } from "./components/ui";
import { ReconnectBanner } from "./components/chat";
import { MessageAnnouncer } from "./components/chat";
import { StatusSelector } from "./components/chat";
import { bootApp, logout } from "./lib/boot";
import { retryNow, startRealtime } from "./lib/realtime";
import {
  closeWindow,
  getPreferences,
  isMaximized,
  lockSession,
  minimizeWindow,
  onWindowMaximized,
  setPreferences,
  toggleMaximize,
} from "./lib/bridge";
import { useApp } from "./store";
import type { AppPreferences } from "../electron/ipc-contract";
import { Login } from "./features/auth/Login";
import { ReauthOverlay } from "./features/auth/ReauthOverlay";
import { orderedConversations, Sidebar } from "./features/conversations/Sidebar";
import { useArchivedChannels } from "./features/conversations/useArchivedChannels";
import { ConversationPane, type MessageJump } from "./features/messages/ConversationPane";
import { SearchHost, type SearchMode } from "./features/search/SearchHost";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { AdminPanel } from "./features/admin/AdminPanel";
import { useMessageAnnouncer, useNotificationSounds } from "./features/notifications/useNotifications";
import { useUploads } from "./features/files/useUploads";

export function App() {
  return (
    <I18nProvider>
      <Root />
    </I18nProvider>
  );
}

function Root() {
  const [booted, setBooted] = useState(false);
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const user = useApp((state) => state.user);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loaded] = await Promise.all([getPreferences(), bootApp()]);
      if (!cancelled) {
        setPrefs(loaded);
        setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePrefs = useCallback((patch: Partial<AppPreferences>) => {
    setPrefs((current) => (current === null ? current : { ...current, ...patch }));
    void setPreferences(patch);
  }, []);

  if (!booted) return null;

  return (
    <ThemeProvider
      preference={prefs?.theme ?? "system"}
      onChange={(preference: ThemePreference) => updatePrefs({ theme: preference })}
    >
      <ToastProvider>
        <ShortcutsProvider>
          {user !== null && prefs !== null ? (
            <Shell prefs={prefs} onPrefsChange={updatePrefs} />
          ) : (
            <Login />
          )}
          <ReauthOverlay />
        </ShortcutsProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function Shell({
  prefs,
  onPrefsChange,
}: {
  prefs: AppPreferences;
  onPrefsChange: (patch: Partial<AppPreferences>) => void;
}) {
  const t = useI18n();
  const user = useApp((state) => state.user);
  const connection = useApp((state) => state.connection);
  const reconnectAttempt = useApp((state) => state.reconnectAttempt);
  const conversations = useApp((state) => state.conversations);
  const activeId = useApp((state) => state.activeConversationId);
  const setActive = useApp((state) => state.setActiveConversation);
  const markRead = useApp((state) => state.markRead);
  const myStatus = useApp((state) => state.myStatus);
  const statusMessage = useApp((state) => state.statusMessage);
  const setMyStatus = useApp((state) => state.setMyStatus);
  const setStatusMessage = useApp((state) => state.setStatusMessage);
  const muted = useApp((state) => state.mutedConversations);
  const setMuted = useApp((state) => state.setMutedConversations);
  const serverVersionNotice = useApp((state) => state.serverVersionNotice);
  const ackServerVersion = useApp((state) => state.ackServerVersion);

  useEffect(() => startRealtime(), []);

  useNotificationSounds(prefs.soundsEnabled);
  const announcement = useMessageAnnouncer();

  const uploads = useUploads();
  const archivedChannels = useArchivedChannels(user?.role === "admin");

  const [search, setSearch] = useState<{ open: boolean; mode: SearchMode }>({
    open: false,
    mode: "global",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [jump, setJump] = useState<MessageJump | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    void isMaximized().then(setMaximized);
    return onWindowMaximized(setMaximized);
  }, []);

  // Drag-and-drop na JANELA INTEIRA (§8.6): o composer sinaliza via props,
  // a fila é da conversa ativa.
  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes("Files");
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(true);
    };
    const onDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragActive(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragActive(false);
      const target = activeIdRef.current;
      if (target === null) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      uploads.addFiles(target, files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploads]);

  const orderedIds = useMemo(
    () => orderedConversations(conversations).map((summary) => summary.conversation.id),
    [conversations],
  );

  const switchConversation = useCallback(
    (direction: 1 | -1) => {
      if (orderedIds.length === 0 || activeId === null) return;
      const index = orderedIds.indexOf(activeId);
      const next = (index + direction + orderedIds.length) % orderedIds.length;
      setActive(orderedIds[next]);
    },
    [orderedIds, activeId, setActive],
  );

  const toggleMuteActive = useCallback(() => {
    if (activeId === null) return;
    const next = muted.includes(activeId)
      ? muted.filter((id) => id !== activeId)
      : [...muted, activeId];
    setMuted(next);
    void setPreferences({ mutedConversations: next });
  }, [activeId, muted, setMuted]);

  const shortcuts: ShortcutHandlers = {
    search: () => {
      setSearch({ open: true, mode: "global" });
      return true;
    },
    newConversation: () => {
      setSearch({ open: true, mode: "people" });
      return true;
    },
    conversationSearch: () => {
      if (activeId === null) return false;
      setSearch({ open: true, mode: "conversation" });
      return true;
    },
    prevConversation: () => {
      switchConversation(-1);
      return true;
    },
    nextConversation: () => {
      switchConversation(1);
      return true;
    },
    markAllRead: () => {
      for (const summary of conversations) {
        if (summary.unread_count > 0) markRead(summary.conversation.id);
      }
      return true;
    },
    settings: () => {
      setSettingsOpen(true);
      return true;
    },
    lockSession: () => {
      void lockSession();
      return true;
    },
    muteConversation: () => {
      if (activeId === null) return false;
      toggleMuteActive();
      return true;
    },
    close: () => {
      if (search.open) {
        setSearch((current) => ({ ...current, open: false }));
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      return false;
    },
  };
  useShortcutScope(shortcuts, { id: "app-shell" });

  const showReconnect = connection === "reconnecting" || connection === "offline";

  return (
    <div className="flex h-full flex-col">
      {/* Barra de título custom (44 px, §4) */}
      <header className="titlebar-drag flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--titlebar)] px-2">
        <div className="flex items-center gap-2 pl-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[var(--radius-full)] bg-[var(--accent)]" />
          <span className="text-[length:var(--fs-list)] font-medium text-[var(--text)]">
            {t.appName}
          </span>
        </div>

        <div className="titlebar-no-drag flex items-center gap-1">
          <IconButton
            label={t.sidebar.collapse}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <PanelLeft size={16} strokeWidth={2} />
          </IconButton>
          <button
            type="button"
            onClick={() => setSearch({ open: true, mode: "global" })}
            className="tz-colors flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-[length:var(--fs-list)] text-[var(--text-3)] hover:bg-[var(--bg-hover)]"
          >
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            <span className="hidden md:inline">{t.nav.searchPlaceholder}</span>
          </button>

          <StatusSelector
            status={myStatus}
            note={statusMessage?.text ?? ""}
            onStatusChange={setMyStatus}
            onNoteChange={(note) => setStatusMessage(note === "" ? null : note)}
            trigger={
              // button (não span): o Radix injeta aria-haspopup/aria-expanded/
              // aria-controls no gatilho — atributos permitidos apenas em
              // elementos interativos (axe aria-allowed-attr).
              <button
                type="button"
                className="tz-colors flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[length:var(--fs-list)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
              >
                <Avatar name={user?.display_name ?? "?"} size={20} presence={myStatus} />
                <span className="hidden lg:inline">{t.status[myStatus]}</span>
                <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className="text-[var(--text-3)]" />
              </button>
            }
          />

          {user?.role === "admin" && (
            <IconButton
              label={t.admin.title}
              onClick={() => setAdminOpen(true)}
              className="text-[var(--text-2)]"
            >
              <Shield size={16} strokeWidth={2} />
            </IconButton>
          )}
          <IconButton label={t.settings.title} onClick={() => setSettingsOpen(true)}>
            <Settings size={16} strokeWidth={2} />
          </IconButton>
          <IconButton label={t.nav.logout} onClick={() => void logout()}>
            <LogOut size={16} strokeWidth={2} />
          </IconButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--border)]" />
          <WindowControls maximized={maximized} />
        </div>
      </header>

      {serverVersionNotice && (
        <div
          role="status"
          className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--accent-soft)] px-3 text-[length:var(--fs-list)] text-[var(--text)]"
        >
          <span className="truncate">{t.serverUpdate.banner}</span>
          <button
            type="button"
            onClick={ackServerVersion}
            className="tz-colors flex h-8 shrink-0 items-center rounded-[var(--radius-sm)] px-2 text-[length:var(--fs-meta)] font-medium text-[var(--accent)] hover:bg-[var(--bg-hover)]"
          >
            {t.serverUpdate.dismiss}
          </button>
        </div>
      )}

      {showReconnect && (
        <ReconnectBanner
          state={connection === "offline" ? "offline" : "connecting"}
          attempt={reconnectAttempt}
          onTryNow={() => retryNow()}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={sidebarCollapsed}
          onOpenSearch={() => setSearch({ open: true, mode: "global" })}
          onNewConversation={() => setSearch({ open: true, mode: "people" })}
        />
        <ConversationPane
          uploads={uploads}
          archivedChannels={archivedChannels}
          jump={jump}
          onJumpHandled={() => setJump(null)}
          isDragActive={dragActive}
        />
      </div>

      <SearchHost
        open={search.open}
        mode={search.mode}
        onClose={() => setSearch((current) => ({ ...current, open: false }))}
        onJumpToMessage={(conversationId, seq) => {
          setActive(conversationId);
          setJump({ conversationId, seq });
        }}
      />

      {settingsOpen && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
        />
      )}

      {adminOpen && user?.role === "admin" && (
        <AdminPanel onClose={() => setAdminOpen(false)} />
      )}

      <MessageAnnouncer text={announcement} />
    </div>
  );
}

function WindowControls({ maximized }: { maximized: boolean }) {
  const t = useI18n();
  return (
    <div className="titlebar-no-drag flex items-center gap-1">
      <button
        type="button"
        onClick={() => void minimizeWindow()}
        aria-label={t.titlebar.minimize}
        title={t.titlebar.minimize}
        className="tz-colors flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
      >
        <Minus size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => void toggleMaximize()}
        aria-label={maximized ? t.titlebar.restore : t.titlebar.maximize}
        title={maximized ? t.titlebar.restore : t.titlebar.maximize}
        className="tz-colors flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]"
      >
        <Square size={12} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => void closeWindow()}
        aria-label={t.titlebar.close}
        title={t.titlebar.close}
        className="tz-colors flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--danger)] hover:text-white"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
