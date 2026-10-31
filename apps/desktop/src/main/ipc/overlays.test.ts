import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayManifest } from "@overlay/overlays/contract";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { IPC } from "../../shared/types";
import { OverlaySettingsStore } from "../overlay-settings-store";
import type { IpcContext } from "./context";
import { broadcastOverlayChanges, createOverlayIpcHandlers } from "./overlays";

const manifest: OverlayManifest = {
  id: "test",
  title: "Test",
  description: "",
  sims: ["iracing"],
  defaultSize: { width: 100, height: 100 },
  minSize: { width: 50, height: 50 },
  defaultPosition: { x: 0, y: 0 },
  table: false,
  fields: [],
  settings: [{ key: "flag", label: "Flag", kind: "toggle", default: true }],
  rateHz: 10,
  defaultEnabled: true,
};

type Kind = "settings" | "overlay" | "other";
const sender = (kind: Kind) => ({ sender: { kind } as unknown as Electron.WebContents });

let dir: string;
let store: OverlaySettingsStore;
let ctx: IpcContext;
const broadcast = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-ipc-"));
  store = new OverlaySettingsStore(join(dir, "s.json"), [manifest]);
  broadcast.mockReset();
  ctx = {
    userData: dir,
    isSettingsSender: (s) => (s as unknown as { kind: Kind }).kind === "settings",
    isOverlaySender: (s) => (s as unknown as { kind: Kind }).kind === "overlay",
    broadcast,
    deny: (channel) => {
      throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
    },
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const handlers = () => createOverlayIpcHandlers(ctx, store);

describe("overlay IPC handlers", () => {
  it.each([IPC.overlaysGetAll, IPC.overlaysGet])(
    "%s: settings and overlay windows only",
    (channel) => {
      const h = handlers()[channel];
      expect(h?.(sender("settings"), "test")).toBeTruthy();
      expect(h?.(sender("overlay"), "test")).toBeTruthy();
      expect(() => h?.(sender("other"), "test")).toThrow(/Rejected/);
    },
  );

  it.each([IPC.overlaysUpdate, IPC.overlaysReset])("%s: settings window only", (channel) => {
    const h = handlers()[channel];
    expect(h?.(sender("settings"), "test", {})).toBeTruthy();
    expect(() => h?.(sender("overlay"), "test", {})).toThrow(/Rejected/);
    expect(() => h?.(sender("other"), "test", {})).toThrow(/Rejected/);
  });

  it("returns null for an unknown or non-string id", () => {
    const h = handlers();
    for (const id of ["nope", 5, undefined, { id: "test" }]) {
      expect(h[IPC.overlaysGet]?.(sender("settings"), id)).toBeNull();
      expect(h[IPC.overlaysUpdate]?.(sender("settings"), id, {})).toBeNull();
      expect(h[IPC.overlaysReset]?.(sender("settings"), id)).toBeNull();
    }
  });

  it("sanitises the patch it is given", () => {
    const h = handlers();
    const out = h[IPC.overlaysUpdate]?.(sender("settings"), "test", {
      enabled: "x",
      options: { flag: false, junk: 1 },
    });
    expect(out).toMatchObject({ enabled: true, options: { flag: false } });
  });

  it("broadcasts overlays:changed on a real change only", () => {
    broadcastOverlayChanges(ctx, store);
    const h = handlers();
    h[IPC.overlaysUpdate]?.(sender("settings"), "test", { options: { flag: false } });
    h[IPC.overlaysUpdate]?.(sender("settings"), "test", { options: { flag: false } });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(IPC.overlaysChanged, "test", store.get("test"));
  });
});
