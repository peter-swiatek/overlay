import { lockedCssVars, themeToCssVars, themeTone } from "@overlay/theme";
import type { ActiveTheme } from "@overlay/theme/types";

/** The part of `document.documentElement` that applying a theme touches. */
export interface ThemeRoot {
  style: { setProperty(name: string, value: string): void };
  dataset: Record<string, string | undefined>;
}

/**
 * Writes the theme's colour variables, the global typography variables, `data-compact` and
 * `data-tone` ("light" | "dark") onto the root. Never writes locked variables.
 */
export function applyThemeToRoot(root: ThemeRoot, { theme, typography }: ActiveTheme): void {
  for (const [name, value] of Object.entries(themeToCssVars(theme, typography))) {
    root.style.setProperty(name, value);
  }
  root.dataset.compact = String(typography.compact);
  root.dataset.tone = themeTone(theme.tokens.text);
}

/** Writes the locked colours. They come from LOCKED_COLOURS only, never from a theme object. */
export function applyLockedToRoot(root: ThemeRoot): void {
  for (const [name, value] of Object.entries(lockedCssVars())) {
    root.style.setProperty(name, value);
  }
}
