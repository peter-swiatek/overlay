import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildChannel } from "../shared/build-info";
import { UpdateSettingsStore, parseUpdateSettings } from "./update-settings";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  RESULT_DISPLAY_MS,
  Updater,
  type AutoUpdaterLike,
} from "./updater";

type Handler = (arg?: never) => void;

function makeHarness(opts: { channel?: BuildChannel; isPackaged?: boolean; allow?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    requestHeaders: null as Record<string, string> | null,
    logger: null as unknown,
    on: vi.fn((event: string, fn: Handler) => {
      handlers.set(event, fn);
    }),
    checkForUpdates: vi.fn((): Promise<unknown> => Promise.resolve(null)),
    quitAndInstall: vi.fn(),
  };
  let allow = opts.allow ?? false;
  const settings = {
    load: () => ({ allowPrerelease: allow }),
    update: vi.fn((patch: { allowPrerelease?: boolean }) => {
      allow = patch.allowPrerelease ?? allow;
      return { allowPrerelease: allow };
    }),
  };
  // Minimal fake clock.
  let now = 0;
  const timers: { id: number; at: number; every?: number; fn: () => void }[] = [];
  let nextId = 1;
  const add = (fn: () => void, ms: number, every?: number): (() => void) => {
    const id = nextId++;
    timers.push({ id, at: now + ms, every, fn });
    return () => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    };
  };
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every;
      else timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
    now = end;
  };
  const onChange = vi.fn();
  const getAutoUpdater = vi.fn();
  const prepareToQuit = vi.fn(() => Promise.resolve());
  const updater = new Updater({
    getAutoUpdater: () => {
      getAutoUpdater();
      return autoUpdater as unknown as AutoUpdaterLike;
    },
    prepareToQuit,
    settings,
    channel: opts.channel ?? "release",
    isPackaged: opts.isPackaged ?? true,
    setTimer: (fn, ms) => add(fn, ms),
    setRepeating: (fn, ms) => add(fn, ms, ms),
    onChange,
    log: () => {},
  });
  const emit = (event: string, arg?: unknown): void => handlers.get(event)?.(arg as never);
  return {
    updater,
    autoUpdater,
    settings,
    advance,
    emit,
    onChange,
    timers,
    getAutoUpdater,
    prepareToQuit,
  };
}

describe("update gating", () => {
  it("runs for every packaged build except local", () => {
    for (const [channel, isPackaged, expected] of [
      ["release", true, true],
      ["dev", true, true],
      ["local", true, false],
      ["release", false, false],
      ["dev", false, false],
      ["local", false, false],
    ] as const) {
      const h = makeHarness({ channel, isPackaged });
      h.updater.start();
      expect(h.updater.enabled).toBe(expected);
      expect(h.timers.length).toBe(expected ? 2 : 0);
      h.advance(FIRST_CHECK_DELAY_MS);
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(expected ? 1 : 0);
      expect(h.autoUpdater.on).toHaveBeenCalledTimes(expected ? 5 : 0);
    }
  });

  it("does not touch electron-updater when disabled, and only on start when enabled", () => {
    const off = makeHarness({ channel: "local" });
    off.updater.start();
    off.updater.checkNow();
    off.updater.setAllowPrerelease(true);
    expect(off.getAutoUpdater).not.toHaveBeenCalled();
    const on = makeHarness();
    expect(on.getAutoUpdater).not.toHaveBeenCalled();
    on.updater.start();
    expect(on.getAutoUpdater).toHaveBeenCalled();
  });

  it("checkNow does nothing when disabled", () => {
    const h = makeHarness({ channel: "local" });
    h.updater.checkNow();
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(h.updater.getState()).toEqual({ kind: "idle" });
  });
});

describe("privacy and logging", () => {
  it("pins a fixed staging id header instead of the per-install id", () => {
    const h = makeHarness();
    h.updater.start();
    expect(h.autoUpdater.requestHeaders).toEqual({
      "x-user-staging-id": "00000000-0000-0000-0000-000000000000",
    });
  });

  it("installs a quiet logger: no info, one line for warnings and errors", () => {
    const lines: string[] = [];
    const h = makeHarness();
    // Re-create with a capturing log through a fresh updater.
    const u = new Updater({
      getAutoUpdater: () => h.autoUpdater as unknown as AutoUpdaterLike,
      prepareToQuit: h.prepareToQuit,
      settings: h.settings,
      channel: "release",
      isPackaged: true,
      setTimer: () => () => {},
      setRepeating: () => () => {},
      onChange: () => {},
      log: (m) => lines.push(m),
    });
    u.start();
    const logger = h.autoUpdater.logger as {
      info(m: unknown): void;
      error(m: unknown): void;
    };
    logger.info("<feed>xml</feed>");
    logger.error(new Error("bad\n    at stack line"));
    expect(lines).toEqual(["error: bad"]);
  });
});

describe("scheduling", () => {
  it("checks 30 s after start, then every 6 h", () => {
    const h = makeHarness();
    h.updater.start();
    h.advance(FIRST_CHECK_DELAY_MS - 1);
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    h.emit("update-not-available");
    h.advance(CHECK_INTERVAL_MS - FIRST_CHECK_DELAY_MS);
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    h.emit("update-not-available");
    h.advance(CHECK_INTERVAL_MS);
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it("stop cancels pending checks", () => {
    const h = makeHarness();
    h.updater.start();
    h.updater.stop();
    h.advance(CHECK_INTERVAL_MS * 2);
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("configures download and install behaviour without restarting on its own", () => {
    const h = makeHarness();
    h.updater.start();
    expect(h.autoUpdater.autoDownload).toBe(true);
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(true);
    h.emit("update-available", { version: "0.2.0" });
    h.emit("update-downloaded", { version: "0.2.0" });
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("does not start a second check while one runs or an update is downloaded", () => {
    const h = makeHarness();
    h.updater.start();
    h.updater.checkNow();
    h.updater.checkNow();
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    h.emit("update-downloaded", { version: "0.2.0" });
    h.updater.checkNow();
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe("allowPrerelease", () => {
  it("starts from the persisted setting", () => {
    const h = makeHarness({ allow: true });
    h.updater.start();
    expect(h.autoUpdater.allowPrerelease).toBe(true);
  });

  it("defaults to false", () => {
    const h = makeHarness();
    h.updater.start();
    expect(h.autoUpdater.allowPrerelease).toBe(false);
  });

  it("persists and applies a change, and notifies the tray", () => {
    const h = makeHarness();
    h.updater.start();
    h.onChange.mockClear();
    h.updater.setAllowPrerelease(true);
    expect(h.settings.update).toHaveBeenCalledWith({ allowPrerelease: true });
    expect(h.autoUpdater.allowPrerelease).toBe(true);
    expect(h.updater.allowPrerelease).toBe(true);
    expect(h.onChange).toHaveBeenCalled();
  });
});

describe("lifecycle states", () => {
  it("follows checking, available, downloaded", () => {
    const h = makeHarness();
    h.updater.start();
    h.updater.checkNow();
    expect(h.updater.getState()).toEqual({ kind: "checking" });
    h.emit("update-available", { version: "0.2.0" });
    expect(h.updater.getState()).toEqual({ kind: "available", version: "0.2.0" });
    h.emit("update-downloaded", { version: "0.2.0" });
    expect(h.updater.getState()).toEqual({ kind: "downloaded", version: "0.2.0" });
  });

  it("shows Up to date briefly, then goes idle", () => {
    const h = makeHarness();
    h.updater.start();
    h.updater.checkNow();
    h.emit("update-not-available");
    expect(h.updater.getState()).toEqual({ kind: "up-to-date" });
    h.advance(RESULT_DISPLAY_MS);
    expect(h.updater.getState()).toEqual({ kind: "idle" });
  });

  it("shows an error from the event, then goes idle", () => {
    const h = makeHarness();
    h.updater.start();
    h.updater.checkNow();
    h.emit("error", new Error("offline"));
    expect(h.updater.getState()).toEqual({ kind: "error", message: "offline" });
    h.advance(RESULT_DISPLAY_MS);
    expect(h.updater.getState()).toEqual({ kind: "idle" });
  });

  it("reports a rejected check that raised no event", async () => {
    const h = makeHarness();
    h.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error("boom"));
    h.updater.start();
    h.updater.checkNow();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.updater.getState()).toEqual({ kind: "error", message: "boom" });
  });

  it("restarts only when an update is downloaded", async () => {
    const h = makeHarness();
    h.updater.start();
    await h.updater.restartToUpdate();
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    h.emit("update-downloaded", { version: "0.2.0" });
    await h.updater.restartToUpdate();
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("quitAndInstall(false, true) runs only after prepareToQuit resolves, once", async () => {
    const h = makeHarness();
    let release: () => void = () => {};
    h.prepareToQuit.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    h.updater.start();
    h.emit("update-downloaded", { version: "0.2.0" });
    const first = h.updater.restartToUpdate();
    const second = h.updater.restartToUpdate(); // double click
    await Promise.resolve();
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(h.prepareToQuit).toHaveBeenCalledTimes(1);
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("swallows a rejected background download", async () => {
    const h = makeHarness();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    h.autoUpdater.checkForUpdates.mockResolvedValueOnce({
      downloadPromise: Promise.reject(new Error("download failed")),
    });
    h.updater.start();
    h.updater.checkNow();
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(h.updater.getState()).toEqual({ kind: "checking" });
  });
});

describe("update settings file", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to false and ignores junk", () => {
    expect(parseUpdateSettings(undefined)).toEqual({ allowPrerelease: false });
    expect(parseUpdateSettings({ updates: { allowPrerelease: "yes" } })).toEqual({
      allowPrerelease: false,
    });
  });

  it("round-trips through the updates section", () => {
    const dir = mkdtempSync(join(tmpdir(), "update-settings-"));
    dirs.push(dir);
    const store = new UpdateSettingsStore(join(dir, "updates.json"));
    expect(store.load().allowPrerelease).toBe(false);
    store.update({ allowPrerelease: true });
    expect(new UpdateSettingsStore(join(dir, "updates.json")).load().allowPrerelease).toBe(true);
  });
});
