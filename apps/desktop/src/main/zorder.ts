/**
 * Keeps the overlay windows above borderless/fullscreen sims that re-assert their own z-order
 * when they are activated. Nothing here activates an overlay: no focus(), show() or moveTop().
 */

/** The slice of BrowserWindow this logic needs (lets tests use plain fakes). */
export interface RaisableWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  setAlwaysOnTop(flag: boolean, level?: "screen-saver"): void;
  getNativeWindowHandle(): Buffer;
}

/** Win32 side, behind an interface so tests can fake it. */
export interface NativeZOrder {
  /** SetWindowPos(hwnd, HWND_TOPMOST, ..., SWP_NOACTIVATE). */
  setTopmost(hwnd: number): void;
  /** Unhooks the foreground event hook and releases the native callback. */
  dispose(): void;
}

/** Registers the foreground hook. Resolves undefined when native calls are unavailable. */
export type NativeLoader = (
  onForeground: (hwnd: number) => void,
) => Promise<NativeZOrder | undefined>;

export interface ZOrderKeeperDeps {
  /** Overlay windows to keep on top. */
  getOverlays: () => RaisableWindow[];
  /** HWNDs of every window this app owns; foreground events for these are ignored. */
  getOwnHandles: () => number[];
  loadNative: NativeLoader | undefined;
}

export const MERGE_WINDOW_MS = 50;
export const FOLLOW_UP_DELAY_MS = 250;
export const FALLBACK_INTERVAL_MS = 500;

/** Reads a window's HWND (a pointer-sized little-endian integer in a Buffer). */
export function hwndOf(win: RaisableWindow): number {
  return Number(win.getNativeWindowHandle().readBigUInt64LE(0));
}

export class ZOrderKeeper {
  private native: NativeZOrder | undefined;
  private fallbackTimer: NodeJS.Timeout | undefined;
  private followUpTimer: NodeJS.Timeout | undefined;
  private lastRaise = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(private readonly deps: ZOrderKeeperDeps) {}

  async start(): Promise<void> {
    this.fallbackTimer = setInterval(() => this.onFallbackTick(), FALLBACK_INTERVAL_MS);
    if (!this.deps.loadNative) return;
    try {
      const native = await this.deps.loadNative((hwnd) => this.onForegroundChanged(hwnd));
      if (this.disposed) native?.dispose();
      else this.native = native;
    } catch (error) {
      console.warn("Overlay z-order hook unavailable; using the timer only", error);
    }
  }

  /** Call after an overlay is shown or edit mode ends. */
  requestRaise(): void {
    if (this.disposed) return;
    const now = performance.now();
    // Events within the merge window are covered by the raise (and follow-up) already done.
    if (now - this.lastRaise < MERGE_WINDOW_MS) return;
    this.lastRaise = now;
    this.raiseNow();
    clearTimeout(this.followUpTimer);
    // The sim may re-assert its z-order shortly after it activates, so raise once more.
    this.followUpTimer = setTimeout(() => this.raiseNow(), FOLLOW_UP_DELAY_MS);
  }

  private onForegroundChanged(hwnd: number): void {
    try {
      if (this.disposed) return;
      if (this.deps.getOwnHandles().includes(hwnd)) return;
      this.requestRaise();
    } catch (error) {
      console.warn("Overlay z-order callback failed", error);
    }
  }

  private visibleOverlays(): RaisableWindow[] {
    return this.deps.getOverlays().filter((w) => !w.isDestroyed() && w.isVisible());
  }

  private raiseNow(): void {
    if (this.disposed) return;
    for (const win of this.visibleOverlays()) {
      try {
        this.native?.setTopmost(hwndOf(win));
      } catch (error) {
        console.warn("SetWindowPos failed", error);
      }
    }
  }

  /** Electron's own API: works even if the native module failed to load. */
  private onFallbackTick(): void {
    this.reassertElectron();
    // Covers a missed hook event or a native load that finished after the overlays appeared.
    if (this.native) this.raiseNow();
  }

  private reassertElectron(): void {
    for (const win of this.visibleOverlays()) win.setAlwaysOnTop(true, "screen-saver");
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.fallbackTimer);
    clearTimeout(this.followUpTimer);
    this.fallbackTimer = undefined;
    this.followUpTimer = undefined;
    this.native?.dispose();
    this.native = undefined;
  }
}
