"use client";

import type { ReactNode } from "react";

import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemeMenu } from "./theme/ThemeMenu";
import { InteractionFeedback } from "./InteractionFeedback";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <InteractionFeedback />
      <div className="global-theme-content">{children}</div>
      <div id="global-theme-fallback">
        <ThemeMenu fallback />
      </div>
    </ThemeProvider>
  );
}
