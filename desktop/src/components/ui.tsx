import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { initials, hashColor } from "../lib/format";
import type { PresenceStatus } from "../types";

const PRESENCE_COLOR: Record<PresenceStatus, string> = {
  available: "var(--success)",
  busy: "var(--danger)",
  away: "var(--warning)",
  dnd: "var(--dnd)",
  invisible: "var(--offline)",
  offline: "var(--offline)",
};

export function Avatar({
  name,
  status,
  size = 32,
}: {
  name: string;
  status?: PresenceStatus;
  size?: number;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
        style={{ background: hashColor(name), fontSize: size * 0.4 }}
      >
        {initials(name)}
      </div>
      {status && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[var(--bg-sidebar)]"
          style={{ width: size * 0.34, height: size * 0.34, background: PRESENCE_COLOR[status] }}
        />
      )}
    </div>
  );
}

export function PresenceDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: 8, height: 8, background: PRESENCE_COLOR[status] }}
    />
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
    ghost: "text-[var(--text-2)] hover:bg-[var(--bg-hover)]",
    danger: "bg-[var(--danger)] text-white hover:opacity-90",
  } as const;
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function IconButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-2)] transition-colors hover:bg-[var(--bg-hover)] ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-3)] focus:border-[var(--accent)] ${className}`}
      {...props}
    />
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--text-3)] border-t-transparent" />
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-[var(--text-3)]">{icon}</div>
      <div className="text-[var(--text-2)]">{title}</div>
      {hint && <div className="text-sm text-[var(--text-3)]">{hint}</div>}
    </div>
  );
}
