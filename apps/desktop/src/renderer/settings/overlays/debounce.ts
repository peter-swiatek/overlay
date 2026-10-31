export interface TimerApi<H> {
  set(fn: () => void, ms: number): H;
  clear(handle: H): void;
}

export const SLIDER_DEBOUNCE_MS = 150;

export const browserTimer: TimerApi<ReturnType<typeof setTimeout>> = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

export interface Debouncer {
  /** Runs `run` after `ms` of quiet for this key; a newer call for the same key replaces it. */
  schedule(key: string, run: () => void, ms?: number): void;
  /** Runs every pending call now. */
  flush(): void;
}

export function createDebouncer<H>(timer: TimerApi<H>): Debouncer {
  const pending = new Map<string, { handle: H; run: () => void }>();
  return {
    schedule(key, run, ms = SLIDER_DEBOUNCE_MS) {
      const old = pending.get(key);
      if (old) timer.clear(old.handle);
      const handle = timer.set(() => {
        pending.delete(key);
        run();
      }, ms);
      pending.set(key, { handle, run });
    },
    flush() {
      const entries = [...pending.values()];
      pending.clear();
      for (const e of entries) {
        timer.clear(e.handle);
        e.run();
      }
    },
  };
}
