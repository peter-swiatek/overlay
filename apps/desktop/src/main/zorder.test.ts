import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_INTERVAL_MS,
  FOLLOW_UP_DELAY_MS,
  ZOrderKeeper,
  hwndOf,
  type NativeZOrder,
  type RaisableWindow,
} from "./zorder";

function fakeWindow(hwnd: number, opts: { visible?: boolean; destroyed?: boolean } = {}) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(hwnd));
  return {
    isDestroyed: () => opts.destroyed ?? false,
    isVisible: () => opts.visible ?? true,
    setAlwaysOnTop: vi.fn(),
    getNativeWindowHandle: () => buf,
  } satisfies RaisableWindow;
}

function setup(windows: RaisableWindow[], own: number[] = [900]) {
  const topmost: number[] = [];
  const dispose = vi.fn();
  let fire: (hwnd: number) => void = () => {};
  const native: NativeZOrder = { setTopmost: (h) => topmost.push(h), dispose };
  const keeper = new ZOrderKeeper({
    getOverlays: () => windows,
    getOwnHandles: () => own,
    loadNative: async (cb) => {
      fire = cb;
      return native;
    },
  });
  return { keeper, topmost, dispose, fire: (h: number) => fire(h) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("hwndOf", () => {
  it("reads a 64-bit little-endian handle", () => {
    expect(hwndOf(fakeWindow(0x1234abcd))).toBe(0x1234abcd);
  });
});

describe("ZOrderKeeper", () => {
  it("raises only visible, non-destroyed overlays on a foreground change", async () => {
    const t = setup([
      fakeWindow(1),
      fakeWindow(2, { visible: false }),
      fakeWindow(3, { destroyed: true }),
    ]);
    await t.keeper.start();
    t.fire(500);
    expect(t.topmost).toEqual([1]);
    t.keeper.dispose();
  });

  it("ignores foreground events for our own windows", async () => {
    const t = setup([fakeWindow(1)], [900, 901]);
    await t.keeper.start();
    t.fire(901);
    expect(t.topmost).toEqual([]);
    t.keeper.dispose();
  });

  it("merges events within 50 ms and raises again after 250 ms", async () => {
    const t = setup([fakeWindow(1)]);
    await t.keeper.start();
    t.fire(500);
    vi.advanceTimersByTime(20);
    t.fire(501);
    expect(t.topmost).toEqual([1]);
    vi.advanceTimersByTime(FOLLOW_UP_DELAY_MS);
    expect(t.topmost).toEqual([1, 1]);
    t.fire(502);
    expect(t.topmost).toEqual([1, 1, 1]);
    t.keeper.dispose();
  });

  it("requestRaise raises immediately", async () => {
    const t = setup([fakeWindow(7)]);
    await t.keeper.start();
    t.keeper.requestRaise();
    expect(t.topmost).toEqual([7]);
    t.keeper.dispose();
  });

  it("re-asserts always-on-top through Electron every 500 ms, visible overlays only", async () => {
    const shown = fakeWindow(1);
    const hidden = fakeWindow(2, { visible: false });
    const t = setup([shown, hidden]);
    await t.keeper.start();
    vi.advanceTimersByTime(FALLBACK_INTERVAL_MS * 2);
    expect(shown.setAlwaysOnTop).toHaveBeenCalledTimes(2);
    expect(shown.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(hidden.setAlwaysOnTop).not.toHaveBeenCalled();
    t.keeper.dispose();
  });

  it("keeps the timer when native is unavailable", async () => {
    const win = fakeWindow(1);
    const keeper = new ZOrderKeeper({
      getOverlays: () => [win],
      getOwnHandles: () => [],
      loadNative: async () => undefined,
    });
    await keeper.start();
    vi.advanceTimersByTime(FALLBACK_INTERVAL_MS);
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    keeper.dispose();
  });

  it("keeps the timer when loading native throws", async () => {
    const win = fakeWindow(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const keeper = new ZOrderKeeper({
      getOverlays: () => [win],
      getOwnHandles: () => [],
      loadNative: async () => {
        throw new Error("no koffi");
      },
    });
    await keeper.start();
    vi.advanceTimersByTime(FALLBACK_INTERVAL_MS);
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    keeper.dispose();
    warn.mockRestore();
  });

  it("unhooks and stops all timers on dispose", async () => {
    const win = fakeWindow(1);
    const t = setup([win]);
    await t.keeper.start();
    t.fire(500);
    t.keeper.dispose();
    expect(t.dispose).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(t.topmost).toEqual([1]);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    t.fire(600);
    expect(t.topmost).toEqual([1]);
  });

  it("disposes native that finishes loading after dispose", async () => {
    const dispose = vi.fn();
    const keeper = new ZOrderKeeper({
      getOverlays: () => [],
      getOwnHandles: () => [],
      loadNative: async () => ({ setTopmost: () => {}, dispose }),
    });
    const started = keeper.start();
    keeper.dispose();
    await started;
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
