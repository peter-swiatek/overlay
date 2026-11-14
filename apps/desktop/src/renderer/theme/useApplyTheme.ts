import { useEffect, useState } from "react";
import type { Theme } from "@overlay/theme/types";
import { applyLockedToRoot, applyThemeToRoot } from "./apply";
import "./fonts";
import "./defaults.css";

let lockedApplied = false;

/**
 * Loads the active theme, applies the CSS variables and font to the document, and follows
 * `theme:changed`. Returns the theme, or null until it has loaded.
 */
export function useApplyTheme(): Theme | null {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (!lockedApplied) {
      applyLockedToRoot(root);
      lockedApplied = true;
    }
    let cancelled = false;
    // Set once a theme:changed push arrives; a slower getActive() reply is then stale.
    let pushed = false;
    const apply = (next: Theme): void => {
      if (cancelled) return;
      applyThemeToRoot(root, next);
      setTheme(next);
    };
    window.overlayApi.theme
      .getActive()
      .then((initial) => {
        if (!pushed) apply(initial);
      })
      .catch((err: unknown) => {
        console.error("Could not load the active theme", err);
      });
    const off = window.overlayApi.theme.onChanged((next) => {
      pushed = true;
      apply(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return theme;
}
