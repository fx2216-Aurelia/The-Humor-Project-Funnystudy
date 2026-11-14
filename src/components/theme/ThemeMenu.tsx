"use client";

import { useEffect, useRef, useState } from "react";
import { UserCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";

import { ThemeOptions } from "./ThemeSelector";
import { useTheme } from "./ThemeProvider";

export function ThemeMenu({ fallback = false }: { fallback?: boolean }) {
  const { theme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonId = fallback ? "fallback-theme-menu-button" : "theme-menu-button";
  const panelId = fallback ? "fallback-theme-menu-panel" : "theme-menu-panel";

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

  const statusLabel =
    theme === "system"
      ? `Auto (${resolvedTheme})`
      : theme === "light"
        ? "Light"
        : "Dark";

  return (
    <div
      id={fallback ? "fallback-theme-menu-root" : "theme-menu-root"}
      ref={menuRef}
      className={fallback ? "relative z-50" : "fixed bottom-5 right-4 z-50 sm:bottom-6 sm:right-6"}
    >
      <button
        id={buttonId}
        type="button"
        aria-label={open ? "Close theme menu" : "Open theme menu"}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex h-12 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_4px_14px_rgba(88,123,109,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] ${fallback ? "gap-2 px-4 text-sm font-semibold" : "h-14 w-14 flex-col"}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <XMarkIcon className="h-6 w-6" aria-hidden /> : <UserCircleIcon className="h-6 w-6" aria-hidden />}
        <span className={fallback ? "" : "text-[9px] font-bold leading-none"}>Theme</span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Theme"
          className="interaction-menu absolute bottom-16 right-0 max-h-[calc(100svh-7rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--menu-border)] bg-[var(--menu-surface)] p-4 text-[var(--foreground)] shadow-2xl backdrop-blur-lg"
        >
          <div
            id="theme-menu-header"
            className="flex items-center justify-between gap-2"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--soft)]">
              Theme
            </p>
            <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--soft)] ring-1 ring-[var(--panel-border)]">
              {statusLabel}
            </span>
          </div>
          <div className="mt-4"><ThemeOptions id="theme-menu-options" /></div>
        </div>
      ) : null}
    </div>
  );
}
