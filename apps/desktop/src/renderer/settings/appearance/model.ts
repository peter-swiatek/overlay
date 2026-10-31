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

export type ThemeWriterApi = Pick<OverlayApi["theme"], "save" | "setActive"> &
  Partial<Pick<OverlayApi["theme"], "getState">>;

export interface WriteOptions {
  /**
   * The theme the edit was made on. Without it the theme that is active when the job runs.
   * A preset target is forked once; later writes to the same preset id go to that fork.
   */
  target?: string;
  /** Activate a fork the write creates (default true). A custom target is never activated. */
  activate?: boolean;
}

export interface ThemeWriter {
  write(state: ThemeState, edit: ThemeEdit, options?: WriteOptions): Promise<ThemeState>;
  /** Activates a theme through the same queue, so it lands after writes already issued. */
  select(id: string): Promise<ThemeState>;
  /** The theme a target id currently maps to (a preset that was forked maps to its fork). */
  resolve(target: string): string;
}

interface Waiter {
  resolve(state: ThemeState): void;
  reject(error: unknown): void;
}
type Job =
  | {
      kind: "write";
      state: ThemeState;
      edit: ThemeEdit;
      target: string | undefined;
      activate: boolean;
      waiters: Waiter[];
    }
  | { kind: "select"; state: ThemeState; id: string; waiters: Waiter[] };

/**
 * Saves (and activates when planned) and returns the new state. One call is in flight at a
 * time; edits for the same target that arrive meanwhile are merged into one follow-up job
 * (the latest value of each field wins) that runs against the state the previous call
 * returned. After any failure the state is refetched, so a half-done fork (saved, not
 * activated) is seen by the next job instead of being forked a second time.
 */
export function createThemeWriter(api: ThemeWriterApi): ThemeWriter {
  const queue: Job[] = [];
  let busy = false;
  /** Preset id -> the custom fork made from it; kept until that preset is selected again. */
  const forks = new Map<string, string>();

  function resolveIn(state: ThemeState, target: string): string {
    const fork = forks.get(target);
    const known = [...state.presets, ...state.custom];
    return fork !== undefined && known.some((t) => t.id === fork) ? fork : target;
  }

  async function applyWrite(
    state: ThemeState,
    job: Extract<Job, { kind: "write" }>,
  ): Promise<ThemeState> {
    const all = [...state.presets, ...state.custom];
    const wanted = job.target ?? activeTheme(state).id;
    const id = resolveIn(state, wanted);
    const base = all.find((t) => t.id === id);
    if (!base) throw new Error("That theme no longer exists");
    if (isPreset(state, base.id)) {
      const theme = applyEdit(forkTheme(base, all), job.edit);
      const saved = await api.save(theme);
      forks.set(wanted, theme.id);
      return job.activate ? api.setActive(theme.id) : saved;
    }
    const saved = await api.save(applyEdit(base, job.edit));
    // Retry of a fork whose activation failed: the preset is still the active theme.
    if (id !== wanted && job.activate && saved.activeId === wanted) return api.setActive(id);
    return saved;
  }

  async function apply(state: ThemeState, job: Job): Promise<ThemeState> {
    if (job.kind === "select") {
      forks.delete(job.id);
      return api.setActive(job.id);
    }
    return applyWrite(state, job);
  }

  async function drain(): Promise<void> {
    busy = true;
    let state: ThemeState | null = null;
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        state = await apply(state ?? job.state, job);
        for (const w of job.waiters) w.resolve(state);
      } catch (error) {
        try {
          state = (await api.getState?.()) ?? state;
        } catch {
          // keep the last known state
        }
        for (const w of job.waiters) w.reject(error);
      }
    }
    busy = false;
  }

  function enqueue(job: Job): void {
    queue.push(job);
    if (!busy) void drain();
  }

  return {
    write(state, edit, options = {}) {
      const target = options.target;
      const activate = options.activate ?? true;
      return new Promise<ThemeState>((resolve, reject) => {
        const waiter = { resolve, reject };
        const last = queue[queue.length - 1];
        if (last?.kind === "write" && last.target === target && last.activate === activate) {
          last.edit = mergeEdits(last.edit, edit);
          last.waiters.push(waiter);
        } else enqueue({ kind: "write", state, edit, target, activate, waiters: [waiter] });
      });
    },
    select(id) {
      return new Promise<ThemeState>((resolve, reject) => {
        // The state is only used when nothing ran before; setActive returns the whole state.
        enqueue({
          kind: "select",
          state: { activeId: id, presets: [], custom: [] },
          id,
          waiters: [{ resolve, reject }],
        });
      });
    },
    resolve(target) {
      return forks.get(target) ?? target;
    },
  };
}
