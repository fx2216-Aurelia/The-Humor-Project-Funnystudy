"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Cog6ToothIcon,
  CheckIcon,
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
  UserCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";

import { useTheme } from "./theme/ThemeProvider";
import { SubmitButton } from "./SubmitButton";

export function AccountMenu({
  displayName,
  email,
  signOutAction,
}: {
  displayName: string;
  email?: string | null;
  signOutAction: () => Promise<void>;
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonId = "account-menu-button";
  const panelId = "account-menu-panel";

  useEffect(() => {
    const onClickAway = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div
      id="account-menu-root"
      ref={menuRef}
      className="fixed bottom-5 right-4 z-50 sm:bottom-6 sm:right-6"
    >
      <button
        id={buttonId}
        type="button"
        aria-label={open ? "Close account and theme menu" : "Open account and theme menu"}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-12 w-12 flex-col items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_4px_14px_rgba(88,123,109,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? (
          <XMarkIcon className="h-5 w-5" aria-hidden />
        ) : (
          <UserCircleIcon className="h-5 w-5" aria-hidden />
        )}
        <span className="text-[9px] font-bold leading-none">Theme</span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Account and theme"
          className="interaction-menu absolute bottom-16 right-0 max-h-[calc(100svh-7rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--menu-border)] bg-[var(--menu-surface)] p-4 text-[var(--foreground)] shadow-2xl backdrop-blur-lg"
        >
          <div id="account-menu-meta" className="space-y-1">
            <p className="text-xs uppercase tracking-[0.15em] text-[var(--soft)]">
              Signed in as
            </p>
            <p className="break-words text-sm font-semibold">{displayName}</p>
            {email ? (
              <p className="break-words text-xs text-[var(--soft)]">{email}</p>
            ) : null}
          </div>
          <div id="account-menu-theme" className="mt-5 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--soft)]">
              Theme
            </p>
            <div id="account-menu-theme-options" role="group" aria-label="Color theme" className="flex flex-wrap gap-2">
              {[
                { id: "system" as const, label: "System", icon: <ComputerDesktopIcon className="h-4 w-4" aria-hidden /> },
                { id: "light" as const, label: "Light", icon: <SunIcon className="h-4 w-4" aria-hidden /> },
                { id: "dark" as const, label: "Dark", icon: <MoonIcon className="h-4 w-4" aria-hidden /> },
              ].map((option) => {
                const selected = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={selected && option.id === "system" ? `System, currently ${resolvedTheme}` : option.label}
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
          </div>
          <div className="mt-5 space-y-2">
            <Link
              href="/settings"
              prefetch={false}
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
            >
              <Cog6ToothIcon className="h-4 w-4" aria-hidden />
              Settings
            </Link>
            <form action={signOutAction}>
              <SubmitButton
                pendingLabel="Signing out…"
                className="w-full rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] shadow-[0_4px_14px_rgba(88,123,109,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
              >
                Sign out
              </SubmitButton>
            </form>
            <Link
              href="/terms"
              prefetch={false}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-center text-sm text-[var(--muted)] underline underline-offset-4"
            >
              Policies &amp; terms
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
