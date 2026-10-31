import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
}));

import { IPC } from "../../shared/types";
import { DEFAULT_DISPLAY_SETTINGS, type SettingsStore } from "../settings";
import type { IpcContext } from "./context";
import { registerDisplayIpc, relaunchArgs } from "./display";

const settingsSender = { id: "settings" };
const otherSender = { id: "overlay" };

function setup() {
  handlers.clear();
  const calls: string[] = [];
  const relaunch = vi.fn((args: string[]) => void calls.push(`relaunch ${args.join(" ")}`));
  const quit = vi.fn(() => void calls.push("quit"));
  const ctx = {
    isSettingsSender: (s: unknown) => s === settingsSender,
    deny: (channel: string): never => {
      throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
    },
  } as unknown as IpcContext;
  registerDisplayIpc(ctx, {
    settingsStore: { load: () => DEFAULT_DISPLAY_SETTINGS } as unknown as SettingsStore,
    effective: DEFAULT_DISPLAY_SETTINGS,
    safeMode: false,
    isPackaged: true,
    relaunch,
    quit,
  });
  return { calls, relaunch, quit };
}

describe("relaunchArgs", () => {
  it("drops the executable and --safe-mode, keeps the rest in order", () => {
    expect(relaunchArgs(["app.exe", "--safe-mode", "--foo", "bar"])).toEqual(["--foo", "bar"]);
    expect(relaunchArgs(["app.exe"])).toEqual([]);
    expect(relaunchArgs(["app.exe", "--a", "--safe-mode", "--safe-mode"])).toEqual(["--a"]);
  });
});

describe("app:restart", () => {
  beforeEach(() => handlers.clear());

  it("rejects senders other than the settings window", () => {
    const { relaunch, quit } = setup();
    expect(() => handlers.get(IPC.appRestart)?.({ sender: otherSender })).toThrow(
      /unexpected sender/,
    );
    expect(relaunch).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it("relaunches, then quits", () => {
    const { calls, relaunch, quit } = setup();
    handlers.get(IPC.appRestart)?.({ sender: settingsSender });
    expect(relaunch).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(calls[0]).toMatch(/^relaunch/);
    expect(calls[1]).toBe("quit");
  });
});
