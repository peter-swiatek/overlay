export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Trailing debounce: `schedule` restarts the wait, `flush` runs a pending call now. */
export function createDebouncer(run: () => void, ms: number, timers: Timers = REAL_TIMERS) {
  let handle: unknown = null;
  let pending = false;
  return {
    schedule(): void {
      if (handle !== null) timers.clearTimeout(handle);
      pending = true;
      handle = timers.setTimeout(() => {
        handle = null;
        pending = false;
        run();
      }, ms);
    },
    flush(): void {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      if (!pending) return;
      pending = false;
      run();
    },
    cancel(): void {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      pending = false;
    },
  };
}
