"use client";

import type { ReactNode } from "react";
import {
  CheckIcon,
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/24/solid";

import { useTheme } from "./ThemeProvider";
import type { ThemeChoice } from "./theme";

type ThemeOption = {
  id: ThemeChoice;
  label: string;
  icon: ReactNode;
};

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "system", label: "System", icon: <ComputerDesktopIcon className="h-4 w-4" aria-hidden /> },
  { id: "light", label: "Light", icon: <SunIcon className="h-4 w-4" aria-hidden /> },
  { id: "dark", label: "Dark", icon: <MoonIcon className="h-4 w-4" aria-hidden /> },
];

export function ThemeOptions({ id }: { id?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div id={id} role="group" aria-label="Color theme" className="flex flex-wrap gap-2">
      {THEME_OPTIONS.map((option) => {
        const selected = theme === option.id;
        const accessibleLabel =
          theme === "system" && option.id === "system"
            ? `System, currently ${resolvedTheme}`
            : option.label;

        return (
          <button
            key={option.id}
            type="button"
            aria-label={accessibleLabel}
            aria-pressed={selected}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 text-sm font-semibold transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] ${
              selected
                ? "border-[var(--accent-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]"
                : "border-[var(--input-border)] bg-[var(--card-surface)] text-[var(--foreground)] hover:border-[var(--accent-strong)] hover:bg-[var(--surface-muted)]"
            }`}
            onClick={() => setTheme(option.id)}
          >
            {option.icon}
            <span>{option.label}</span>
            {selected ? <CheckIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeSelector({
  className = "",
  label = "Theme",
  description,
}: {
  className?: string;
  label?: string;
  description?: string;
}) {
  const { theme, resolvedTheme } = useTheme();
  const statusLabel = theme === "system" ? `System (${resolvedTheme})` : theme;

  return (
    <div
      className={`rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] p-4 text-[var(--foreground)] shadow-[var(--panel-shadow)] backdrop-blur-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--soft)]">
            {label}
          </p>
          {description ? <p className="text-xs text-[var(--soft)]">{description}</p> : null}
        </div>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--soft)] ring-1 ring-[var(--panel-border)]">
          {statusLabel}
        </span>
      </div>
      <div className="mt-3"><ThemeOptions /></div>
    </div>
  );
}
