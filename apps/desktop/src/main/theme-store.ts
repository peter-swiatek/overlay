import { DEFAULT_THEME_ID, THEME_PRESETS, sanitizeTheme } from "@overlay/theme";
import type { Theme, ThemeState } from "@overlay/theme/types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

export const MAX_CUSTOM_THEMES = 50;
const CUSTOM_PREFIX = "custom-";

interface ThemesFile {
  version: 1;
  activeId: string;
  custom: Theme[];
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

/** The active theme and the user's own themes, stored in `themes.json`. */
export class ThemeStore {
  private custom: Theme[] = [];
  private activeId: string = DEFAULT_THEME_ID;
  private readonly listeners = new Set<(active: Theme) => void>();

  constructor(private readonly file: string) {
    const raw = readJsonFile(file);
    if (typeof raw === "object" && raw !== null) {
      const data = raw as Record<string, unknown>;
      this.custom = sanitizeCustom(data.custom);
      if (typeof data.activeId === "string" && this.find(data.activeId)) {
        this.activeId = data.activeId;
      }
    }
  }

  getState(): ThemeState {
    return { activeId: this.activeId, presets: THEME_PRESETS, custom: [...this.custom] };
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

  onChange(listener: (active: Theme) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private find(id: string): Theme | undefined {
    return THEME_PRESETS.find((t) => t.id === id) ?? this.custom.find((t) => t.id === id);
  }

  /** Runs a change, saves, and notifies when the active theme or its content changed. */
  private mutate(change: () => void): void {
    const before = JSON.stringify(this.getActive());
    change();
    this.persist();
    const active = this.getActive();
    if (JSON.stringify(active) !== before) for (const listener of this.listeners) listener(active);
  }

  private persist(): void {
    const data: ThemesFile = { version: 1, activeId: this.activeId, custom: this.custom };
    try {
      writeJsonFileAtomic(this.file, data);
    } catch (error) {
      console.error("Could not save themes", error);
    }
  }
}
