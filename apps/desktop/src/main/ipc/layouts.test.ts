import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { IPC } from "../../shared/types";
import type { LayoutSwitcher } from "../layout-switcher";
import { createLayoutIpcHandlers } from "./layouts";

type Kind = "settings" | "overlay";
const from = (kind: Kind) => ({ sender: { kind } as unknown as Electron.WebContents });
const ctx = {
  isSettingsSender: (s: Electron.WebContents) =>
    (s as unknown as { kind: Kind }).kind === "settings",
  deny: (channel: string): never => {
    throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
  },
};

function fakeSwitcher() {
  const state = { layouts: [], activeId: "default", autoSwitch: true, context: {} };
  return {
    state: vi.fn(() => state),
    activate: vi.fn(),
    create: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    setMatch: vi.fn(),
    setAutoSwitch: vi.fn(),
  };
}

describe("layout IPC", () => {
  it("serves the main window only", () => {
    const handlers = createLayoutIpcHandlers(ctx, fakeSwitcher() as unknown as LayoutSwitcher);
    for (const channel of Object.keys(handlers)) {
      expect(() => handlers[channel]?.(from("overlay"))).toThrow(/Rejected IPC/);
    }
    expect(Object.keys(handlers)).toHaveLength(8);
  });

  it("passes valid arguments on and answers with the new state", () => {
    const sw = fakeSwitcher();
    const handlers = createLayoutIpcHandlers(ctx, sw as unknown as LayoutSwitcher);
    expect(handlers[IPC.layoutsActivate]?.(from("settings"), "layout-1")).toEqual(sw.state());
    handlers[IPC.layoutsRename]?.(from("settings"), "layout-1", "Race");
    handlers[IPC.layoutsSetMatch]?.(from("settings"), "layout-1", { sims: ["lmu"] });
    handlers[IPC.layoutsSetAutoSwitch]?.(from("settings"), false);
    handlers[IPC.layoutsCreate]?.(from("settings"));
    expect(sw.activate).toHaveBeenCalledWith("layout-1");
    expect(sw.rename).toHaveBeenCalledWith("layout-1", "Race");
    expect(sw.setMatch).toHaveBeenCalledWith("layout-1", { sims: ["lmu"] });
    expect(sw.setAutoSwitch).toHaveBeenCalledWith(false);
    expect(sw.create).toHaveBeenCalled();
  });

  it("ignores malformed arguments", () => {
    const sw = fakeSwitcher();
    const handlers = createLayoutIpcHandlers(ctx, sw as unknown as LayoutSwitcher);
    handlers[IPC.layoutsActivate]?.(from("settings"), 7);
    handlers[IPC.layoutsRemove]?.(from("settings"), null);
    handlers[IPC.layoutsSetAutoSwitch]?.(from("settings"), "yes");
    expect(sw.activate).not.toHaveBeenCalled();
    expect(sw.remove).not.toHaveBeenCalled();
    expect(sw.setAutoSwitch).not.toHaveBeenCalled();
  });
});
