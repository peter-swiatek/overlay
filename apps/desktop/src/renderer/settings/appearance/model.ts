import { DEFAULT_THEME_ID, forkTheme, sanitizeThemeName } from "@overlay/theme";
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

export const PRESET_LOCKED_MESSAGE =
  "Built-in themes can't be changed. Create your own theme to customise it.";

/** Applies an edit to the active theme. Presets never change: an edit to one is refused. */
export function planThemeEdit(
  state: ThemeState,
  edit: ThemeEdit,
): { theme: Theme } | { error: string } {
  const active = activeTheme(state);
  if (isPreset(state, active.id)) return { error: PRESET_LOCKED_MESSAGE };
  return { theme: applyEdit(active, edit) };
}

/** Default name offered when a theme is created from `base`. */
export function defaultNewThemeName(base: Theme): string {
  return sanitizeThemeName(`${base.name} copy`);
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
  /** The theme the edit was made on. Without it the theme that is active when the job runs. */
  target?: string;
}

export interface ThemeWriter {
  /** Saves an edit to a custom theme. A preset target is refused. */
  write(state: ThemeState, edit: ThemeEdit, options?: WriteOptions): Promise<ThemeState>;
  /** Activates a theme through the same queue, so it lands after writes already issued. */
  select(id: string): Promise<ThemeState>;
  /** Creates a custom theme named `name` from the active theme and activates it. */
  create(state: ThemeState, name: string): Promise<ThemeState>;
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
      waiters: Waiter[];
    }
  | { kind: "select"; state: ThemeState; id: string; waiters: Waiter[] }
  | { kind: "create"; state: ThemeState; name: string; waiters: Waiter[] };

/**
 * Saves and returns the new state. One call is in flight at a time; edits for the same target
 * that arrive meanwhile are merged into one follow-up job (the latest value of each field
 * wins) that runs against the state the previous call returned. After any failure the state
 * is refetched, so the next job starts from what main really has.
 */
export function createThemeWriter(api: ThemeWriterApi): ThemeWriter {
  const queue: Job[] = [];
  let busy = false;

  async function applyWrite(
    state: ThemeState,
    job: Extract<Job, { kind: "write" }>,
  ): Promise<ThemeState> {
    const id = job.target ?? activeTheme(state).id;
    if (isPreset(state, id)) throw new Error(PRESET_LOCKED_MESSAGE);
    const base = state.custom.find((t) => t.id === id);
    if (!base) throw new Error("That theme no longer exists");
    return api.save(applyEdit(base, job.edit));
  }

  async function applyCreate(
    state: ThemeState,
    job: Extract<Job, { kind: "create" }>,
  ): Promise<ThemeState> {
    const all = [...state.presets, ...state.custom];
    const theme = { ...forkTheme(activeTheme(state), all), name: sanitizeThemeName(job.name) };
    await api.save(theme);
    return api.setActive(theme.id);
  }

  async function apply(state: ThemeState, job: Job): Promise<ThemeState> {
    if (job.kind === "select") return api.setActive(job.id);
    if (job.kind === "create") return applyCreate(state, job);
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
      return new Promise<ThemeState>((resolve, reject) => {
        const waiter = { resolve, reject };
        const last = queue[queue.length - 1];
        if (last?.kind === "write" && last.target === target) {
          last.edit = mergeEdits(last.edit, edit);
          last.waiters.push(waiter);
        } else enqueue({ kind: "write", state, edit, target, waiters: [waiter] });
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
    create(state, name) {
      return new Promise<ThemeState>((resolve, reject) => {
        enqueue({ kind: "create", state, name, waiters: [{ resolve, reject }] });
      });
    },
  };
}
