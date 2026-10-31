import { DEFAULT_THEME_ID, forkTheme } from "@overlay/theme";
import type { Theme, ThemeState } from "@overlay/theme/types";
import type { OverlayApi } from "../../../shared/types";

export type ThemeEdit = Partial<Pick<Theme, "name" | "tokens" | "font" | "weight" | "compact">>;

/** The active theme, else Graphite (an unknown id can only mean a stale state). */
export function activeTheme(state: ThemeState): Theme {
  const all = [...state.presets, ...state.custom];
  return (
    all.find((t) => t.id === state.activeId) ??
    state.presets.find((t) => t.id === DEFAULT_THEME_ID) ??
    state.presets[0]!
  );
}

export function isPreset(state: ThemeState, id: string): boolean {
  return state.presets.some((t) => t.id === id);
}

function applyEdit(base: Theme, edit: ThemeEdit): Theme {
  return { ...base, ...edit, tokens: { ...base.tokens, ...edit.tokens } };
}

/** Applies an edit to the active theme. A preset is forked first (presets never change). */
export function planThemeEdit(
  state: ThemeState,
  edit: ThemeEdit,
  random?: () => number,
): { theme: Theme; activate: boolean } {
  const active = activeTheme(state);
  if (!isPreset(state, active.id)) return { theme: applyEdit(active, edit), activate: false };
  const fork = forkTheme(active, [...state.presets, ...state.custom], random);
  return { theme: applyEdit(fork, edit), activate: true };
}

/** Follows `theme:changed`, which carries only the active theme. */
export function applyActiveChanged(state: ThemeState, active: Theme): ThemeState {
  if (isPreset(state, active.id)) return { ...state, activeId: active.id };
  const known = state.custom.some((t) => t.id === active.id);
  const custom = known
    ? state.custom.map((t) => (t.id === active.id ? active : t))
    : [...state.custom, active];
  return { ...state, activeId: active.id, custom };
}

function mergeEdits(a: ThemeEdit, b: ThemeEdit): ThemeEdit {
  const merged: ThemeEdit = { ...a, ...b };
  if (a.tokens || b.tokens) merged.tokens = { ...a.tokens, ...b.tokens } as Theme["tokens"];
  return merged;
}

interface Waiter {
  resolve(state: ThemeState): void;
  reject(error: unknown): void;
}
interface Job {
  state: ThemeState;
  edit: ThemeEdit;
  waiters: Waiter[];
}

/**
 * Saves (and activates when planned) and returns the new state. One call is in flight at a
 * time; edits that arrive meanwhile are merged into one follow-up job (the latest value of
 * each field wins) that runs against the state the previous call returned.
 */
export function createThemeWriter(api: Pick<OverlayApi["theme"], "save" | "setActive">): {
  write(state: ThemeState, edit: ThemeEdit): Promise<ThemeState>;
} {
  let busy = false;
  let queued: Job | null = null;

  async function apply(state: ThemeState, edit: ThemeEdit): Promise<ThemeState> {
    const plan = planThemeEdit(state, edit);
    const saved = await api.save(plan.theme);
    return plan.activate ? api.setActive(plan.theme.id) : saved;
  }

  async function drain(first: Job): Promise<void> {
    busy = true;
    let job: Job | null = first;
    let state = first.state;
    while (job) {
      try {
        state = await apply(state, job.edit);
        for (const w of job.waiters) w.resolve(state);
      } catch (error) {
        for (const w of job.waiters) w.reject(error);
      }
      job = queued;
      queued = null;
    }
    busy = false;
  }

  return {
    write(state, edit) {
      return new Promise<ThemeState>((resolve, reject) => {
        const waiter = { resolve, reject };
        if (!busy) void drain({ state, edit, waiters: [waiter] });
        else if (queued) {
          queued.edit = mergeEdits(queued.edit, edit);
          queued.waiters.push(waiter);
        } else queued = { state, edit, waiters: [waiter] };
      });
    },
  };
}
