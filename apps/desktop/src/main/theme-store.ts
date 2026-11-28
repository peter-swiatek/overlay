import {
  DEFAULT_THEME_ID,
  DEFAULT_TYPOGRAPHY,
  THEME_PRESETS,
  migrateLegacyTypography,
  sanitizeTheme,
  sanitizeTypography,
} from "@overlay/theme";
import type { ActiveTheme, Theme, ThemeState, Typography } from "@overlay/theme/types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

export const MAX_CUSTOM_THEMES = 50;
const CUSTOM_PREFIX = "custom-";

/**
 * Version 1 kept font, weight and compact inside each theme. Version 2 keeps colours only in
 * themes and one global `typography`. A version 1 file is migrated once on load (see
 * migrateLegacyTypography) and rewritten as version 2 straight away.
 */
interface ThemesFile {
  version: 2;
  activeId: string;
  custom: Theme[];
  typography: Typography;
}

/** Keeps valid custom themes with unique `custom-` ids, at most MAX_CUSTOM_THEMES. */
function sanitizeCustom(raw: unknown): Theme[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Theme[] = [];
  for (const item of raw as unknown[]) {
    const result = sanitizeTheme(item);
    if (!result.ok) continue;
    const { theme } = result;
    if (!theme.id.startsWith(CUSTOM_PREFIX) || seen.has(theme.id)) continue;
    seen.add(theme.id);
    out.push(theme);
    if (out.length === MAX_CUSTOM_THEMES) break;
  }
  return out;
}

/**
 * The active theme, the user's own themes and the global typography, stored in `themes.json`.
 * Themes are colour schemes; typography applies on top of whichever theme is active.
 */
export class ThemeStore {
  private custom: Theme[] = [];
  private activeId: string = DEFAULT_THEME_ID;
  private typography: Typography = { ...DEFAULT_TYPOGRAPHY };
  private readonly listeners = new Set<(active: ActiveTheme) => void>();

  constructor(private readonly file: string) {
    const raw = readJsonFile(file);
    if (typeof raw === "object" && raw !== null) {
      const data = raw as Record<string, unknown>;
      this.custom = sanitizeCustom(data.custom);
      if (typeof data.activeId === "string" && this.find(data.activeId)) {
        this.activeId = data.activeId;
      }
      if (data.version === 2) {
        this.typography = sanitizeTypography(data.typography);
      } else {
        // An older file: typography lived in the themes. Lift it out once and save.
        this.typography = migrateLegacyTypography(data.activeId, data.custom);
        this.persist();
      }
    }
  }

  getState(): ThemeState {
    return {
      activeId: this.activeId,
      presets: THEME_PRESETS,
      custom: [...this.custom],
      typography: { ...this.typography },
    };
  }

  /** The active theme with the global typography: what overlays draw with. */
  getApplied(): ActiveTheme {
    return { theme: this.getActive(), typography: { ...this.typography } };
  }

  /** Merges a partial typography change; invalid fields keep their current value. */
  setTypography(patch: unknown): ThemeState {
    const next = sanitizeTypography(patch, this.typography);
    this.mutate(() => (this.typography = next));
    return this.getState();
  }

  getActive(): Theme {
    const active = this.find(this.activeId) ?? this.find(DEFAULT_THEME_ID);
    if (!active) throw new Error("No themes available");
    return active;
  }

  /** An unknown id leaves the state unchanged. */
  setActive(id: string): ThemeState {
    if (this.find(id)) this.mutate(() => (this.activeId = id));
    return this.getState();
  }

  /** Sanitises, then replaces the theme with the same id or appends. Throws on preset ids. */
  save(theme: unknown): ThemeState {
    const result = sanitizeTheme(theme);
    if (!result.ok) throw new Error(result.error);
    const next = result.theme;
    if (!next.id.startsWith(CUSTOM_PREFIX)) throw new Error("Built-in themes cannot be changed");
    const index = this.custom.findIndex((t) => t.id === next.id);
    if (index < 0 && this.custom.length >= MAX_CUSTOM_THEMES) {
      throw new Error(`You can keep up to ${MAX_CUSTOM_THEMES} custom themes`);
    }
    this.mutate(() => {
      if (index >= 0) this.custom[index] = next;
      else this.custom.push(next);
    });
    return this.getState();
  }

  /** Removing the active theme activates the default. Preset ids are ignored. */
  remove(id: string): ThemeState {
    if (this.custom.some((t) => t.id === id)) {
      this.mutate(() => {
        this.custom = this.custom.filter((t) => t.id !== id);
        if (this.activeId === id) this.activeId = DEFAULT_THEME_ID;
      });
    }
    return this.getState();
  }

  onChange(listener: (active: ActiveTheme) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private find(id: string): Theme | undefined {
    return THEME_PRESETS.find((t) => t.id === id) ?? this.custom.find((t) => t.id === id);
  }

  /** Runs a change, saves, and notifies when the active theme, its content or typography changed. */
  private mutate(change: () => void): void {
    const before = JSON.stringify(this.getApplied());
    change();
    this.persist();
    const applied = this.getApplied();
    if (JSON.stringify(applied) !== before) {
      for (const listener of this.listeners) listener(applied);
    }
  }

  private persist(): void {
    const data: ThemesFile = {
      version: 2,
      activeId: this.activeId,
      custom: this.custom,
      typography: this.typography,
    };
    try {
      writeJsonFileAtomic(this.file, data);
    } catch (error) {
      console.error("Could not save themes", error);
    }
  }
}
