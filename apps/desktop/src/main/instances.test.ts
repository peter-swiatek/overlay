import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import { MAX_INSTANCES } from "@overlay/overlays/instances";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { defaultInstanceSettings } from "@overlay/overlays/settings";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { IPC } from "../shared/types";
import type { IpcContext } from "./ipc/context";
import { broadcastOverlayChanges, createOverlayIpcHandlers } from "./ipc/overlays";
import { boundsNextTo, INSTANCE_GAP_PX, parseLayout, planWindowChanges } from "./layout";
import { LayoutStore } from "./layout-store";
import { OverlaySettingsStore, type StoreTimer } from "./overlay-settings-store";

const relative = OVERLAY_MANIFESTS.find((m) => m.id === "relative")!;
const frames = OVERLAY_MANIFESTS.find((m) => m.id === "data-frames")!;

const timer: StoreTimer = {
  setTimeout: (fn) => fn,
  clearTimeout: () => undefined,
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-instances-"));
  file = join(dir, "overlay-settings.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const make = () => new OverlaySettingsStore(file, OVERLAY_MANIFESTS, timer);
const saved = () =>
  JSON.parse(readFileSync(file, "utf8")) as {
    overlays: Record<string, OverlayInstanceSettings>;
  };

describe("overlay instances in the settings store", () => {
  it("adds a switched-on copy of the source and tells listeners", () => {
    const store = make();
    store.update("relative", { common: { scalePct: 130 }, options: { "drivers-ahead": 2 } });
    const heard: string[] = [];
    store.onChange((id) => heard.push(id));
    const id = store.addInstance("relative");
    expect(id).toBe("relative:2");
    expect(heard).toEqual(["relative:2"]);
    const copy = store.get("relative:2")!;
    expect(copy.enabled).toBe(true);
    expect(copy.common.scalePct).toBe(130);
    expect(copy.options["drivers-ahead"]).toBe(2);
    expect(store.get("relative")!.enabled).toBe(relative.defaultEnabled);
  });

  it("keeps each instance's settings apart", () => {
    const store = make();
    store.addInstance("relative");
    store.update("relative:2", { options: { "drivers-ahead": 1 }, name: "Short" });
    store.update("relative", { options: { "drivers-ahead": 5 } });
    expect(store.get("relative")!.options["drivers-ahead"]).toBe(5);
    expect(store.get("relative:2")!.options["drivers-ahead"]).toBe(1);
    expect(store.get("relative:2")!.name).toBe("Short");
    expect(store.get("relative")).not.toHaveProperty("name");
  });

  it("numbers instances from the lowest free number and stops at the most", () => {
    const store = make();
    expect(store.addInstance("data-frames")).toBe("data-frames:2");
    expect(store.addInstance("data-frames:2")).toBe("data-frames:3");
    expect(store.removeInstance("data-frames:2")).toBe(true);
    expect(store.addInstance("data-frames")).toBe("data-frames:2");
    for (let n = 4; n <= MAX_INSTANCES; n++) expect(store.addInstance("data-frames")).toBeDefined();
    expect(store.addInstance("data-frames")).toBeUndefined();
    expect(store.addInstance("ghost")).toBeUndefined();
  });

  it("gives Data Frame instances the board's metrics in order", () => {
    const store = make();
    const metrics = [
      "data-frames",
      ...[1, 2, 3, 4].map(() => store.addInstance("data-frames")!),
    ].map((id) => store.get(id)!.options["metric"]);
    expect(metrics).toEqual([
      "class-position",
      "brake-bias",
      "fuel-level",
      "track-temp",
      "last-lap",
    ]);
  });

  it("removes added instances only, and tells listeners", () => {
    const store = make();
    const removed: string[] = [];
    store.onRemove((id) => removed.push(id));
    store.addInstance("relative");
    expect(store.removeInstance("relative")).toBe(false);
    expect(store.removeInstance("relative:5")).toBe(false);
    expect(store.removeInstance("relative:2")).toBe(true);
    expect(store.get("relative:2")).toBeUndefined();
    expect(removed).toEqual(["relative:2"]);
    expect(store.update("relative:2", { enabled: true })).toBeUndefined();
  });

  it("saves instances and reads them back, leaving instance 1 at its plain key", () => {
    const store = make();
    store.update("data-frames", { enabled: true });
    store.addInstance("data-frames");
    store.update("data-frames:2", { options: { metric: "speed" } });
    store.flush();
    const file1 = saved();
    expect(Object.keys(file1.overlays)).toContain("data-frames");
    expect(file1.overlays["data-frames:2"]?.options["metric"]).toBe("speed");
    const again = make();
    expect(again.get("data-frames:2")).toEqual(store.get("data-frames:2"));
    expect(again.get("data-frames")!.enabled).toBe(true);
    again.removeInstance("data-frames:2");
    again.flush();
    expect(saved().overlays).not.toHaveProperty("data-frames:2");
  });

  it("reads a file written before instances existed unchanged", () => {
    const old = {
      version: 1,
      overlays: { relative: { enabled: true, options: { "drivers-ahead": 1 } } },
    };
    writeFileSync(file, JSON.stringify(old));
    const store = make();
    expect(store.get("relative")!.enabled).toBe(true);
    expect(store.get("relative")!.options["drivers-ahead"]).toBe(1);
    expect(Object.keys(store.getAll())).toEqual(OVERLAY_MANIFESTS.map((m) => m.id));
  });

  it("resets an added instance without switching it off or renaming it", () => {
    const store = make();
    store.addInstance("data-frames");
    store.update("data-frames:2", { name: "Bias", options: { metric: "gear" } });
    const reset = store.reset("data-frames:2")!;
    expect(reset).toMatchObject({ enabled: true, name: "Bias", options: { metric: "brake-bias" } });
  });
});

describe("overlay instances in the layout", () => {
  it("keeps bounds of added instances of known overlays", () => {
    const layout = parseLayout(
      {
        relative: { x: 1, y: 2, width: 300, height: 200 },
        "relative:2": { x: 400, y: 2, width: 300, height: 200, scalePct: 120 },
        "ghost:2": { x: 1, y: 2, width: 300, height: 200 },
        "relative:0": { x: 1, y: 2, width: 300, height: 200 },
      },
      OVERLAY_MANIFESTS,
    );
    expect(Object.keys(layout).sort()).toEqual(["relative", "relative:2"]);
    expect(layout["relative:2"]).toMatchObject({ x: 400, scalePct: 120 });
  });

  it("saves and loads instance bounds through the layout store", () => {
    const store = new LayoutStore(join(dir, "layout.json"));
    store.save({ "data-frames:3": { x: 10, y: 20, width: 130, height: 64, scalePct: 100 } });
    expect(store.load(OVERLAY_MANIFESTS)["data-frames:3"]).toEqual({
      x: 10,
      y: 20,
      width: 130,
      height: 64,
      scalePct: 100,
    });
  });

  it("moves the earlier four-tile Data Frames window to one tile's size", () => {
    const layout = parseLayout(
      { "data-frames": { x: 5, y: 6, width: 272, height: 140 } },
      OVERLAY_MANIFESTS,
    );
    expect(layout["data-frames"]).toMatchObject({ x: 5, y: 6, ...frames.defaultSize });
  });

  it("opens a window per enabled instance and closes removed ones", () => {
    const on = { enabled: true } as OverlayInstanceSettings;
    const off = { enabled: false } as OverlayInstanceSettings;
    const plan = planWindowChanges(
      OVERLAY_MANIFESTS,
      { relative: on, "relative:2": on, "relative:3": off, "ghost:2": on },
      ["relative", "relative:4"],
    );
    expect(plan).toEqual({ open: ["relative:2"], close: ["relative:4"] });
  });

  it("places a new instance beside the one before it, never on top of it", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const min = frames.minSize;
    const anchor = { x: 100, y: 100, width: 130, height: 64 };
    const gap = INSTANCE_GAP_PX;
    expect(boundsNextTo(anchor, area, min)).toEqual({ ...anchor, x: 100 + 130 + gap });
    const right = { ...anchor, x: 1920 - 130 };
    expect(boundsNextTo(right, area, min)).toEqual({ ...right, y: 100 + 64 + gap });
    const corner = { ...anchor, x: 1920 - 130, y: 1040 - 64 };
    expect(boundsNextTo(corner, area, min)).toEqual({ ...corner, x: 1920 - 130 - 130 - gap });
    const wide = { x: 0, y: 400, width: 1900, height: 200 };
    expect(boundsNextTo(wide, area, min)).toEqual({ ...wide, y: 400 + 200 + gap });
  });
});

describe("overlay instance IPC", () => {
  const broadcast = vi.fn();
  type Kind = "settings" | "overlay";
  const from = (kind: Kind) => ({ sender: { kind } as unknown as Electron.WebContents });
  const ctx = (): IpcContext => ({
    userData: dir,
    isSettingsSender: (s) => (s as unknown as { kind: Kind }).kind === "settings",
    isOverlaySender: (s) => (s as unknown as { kind: Kind }).kind === "overlay",
    broadcast,
    deny: (channel) => {
      throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
    },
  });

  it("adds and removes instances for the main window only and tells every window", () => {
    broadcast.mockReset();
    const store = make();
    const c = ctx();
    const h = createOverlayIpcHandlers(c, store);
    broadcastOverlayChanges(c, store);
    expect(() => h[IPC.overlaysAddInstance]!(from("overlay"), "relative")).toThrow(/Rejected/);
    expect(() => h[IPC.overlaysRemoveInstance]!(from("overlay"), "relative:2")).toThrow(/Rejected/);
    expect(h[IPC.overlaysAddInstance]!(from("settings"), "relative")).toBe("relative:2");
    expect(h[IPC.overlaysAddInstance]!(from("settings"), 3)).toBeNull();
    expect(h[IPC.overlaysAddInstance]!(from("settings"), "ghost")).toBeNull();
    expect(broadcast).toHaveBeenCalledWith(
      IPC.overlaysChanged,
      "relative:2",
      store.get("relative:2"),
    );
    expect(h[IPC.overlaysGet]!(from("overlay"), "relative:2")).toEqual(store.get("relative:2"));
    expect(
      h[IPC.overlaysUpdate]!(from("settings"), "relative:2", { enabled: false }),
    ).toMatchObject({
      enabled: false,
    });
    expect(h[IPC.overlaysRemoveInstance]!(from("settings"), "relative")).toBe(false);
    expect(h[IPC.overlaysRemoveInstance]!(from("settings"), "relative:2")).toBe(true);
    expect(broadcast).toHaveBeenLastCalledWith(IPC.overlaysRemoved, "relative:2");
    expect(h[IPC.overlaysGet]!(from("overlay"), "relative:2")).toBeNull();
  });

  it("keeps instance 1 at its defaults when an instance is added", () => {
    const store = make();
    store.addInstance("relative");
    expect(store.get("relative")).toEqual(defaultInstanceSettings(relative));
  });
});
