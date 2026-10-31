import { DEFAULT_THEME_ID, THEME_PRESETS } from "@overlay/theme";
import type { Theme, ThemeState } from "@overlay/theme/types";

/** Themes. Stub: in memory, presets only, no validation, does not touch `file` yet. */
export class ThemeStore {
  private state: ThemeState = { activeId: DEFAULT_THEME_ID, presets: THEME_PRESETS, custom: [] };
  private readonly listeners = new Set<(active: Theme) => void>();

  constructor(private readonly file: string) {
    void this.file;
  }

  getState(): ThemeState {
    return this.state;
  }

  getActive(): Theme {
    const all = [...this.state.presets, ...this.state.custom];
    const found = all.find((t) => t.id === this.state.activeId) ?? all[0];
    if (!found) throw new Error("No themes available");
    return found;
  }

  /** An unknown id leaves the state unchanged. */
  setActive(id: string): ThemeState {
    const known = [...this.state.presets, ...this.state.custom].some((t) => t.id === id);
    if (!known) return this.state;
    this.state = { ...this.state, activeId: id };
    const active = this.getActive();
    for (const listener of this.listeners) listener(active);
    return this.state;
  }

  /** Stub: ignores the theme. */
  save(theme: unknown): ThemeState {
    void theme;
    return this.state;
  }

  /** Stub: nothing removable yet. */
  remove(id: string): ThemeState {
    void id;
    return this.state;
  }

  onChange(listener: (active: Theme) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
