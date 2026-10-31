import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/types";
import { DEFAULT_TELEMETRY_SETTINGS, type TelemetrySettings } from "../telemetry-settings";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("../replay-dialog", () => ({ pickReplayFile: vi.fn() }));

const { telemetryHandlers } = await import("./telemetry");

const settingsSender = { id: "s" } as unknown as WebContents;
const otherSender = { id: "o" } as unknown as WebContents;

function setup(pick: string | null) {
  let settings: TelemetrySettings = { ...DEFAULT_TELEMETRY_SETTINGS };
  const updateSettings = vi.fn((patch: Partial<TelemetrySettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  const handlers = telemetryHandlers(
    {
      isSettingsSender: (s) => s === settingsSender,
      deny: (channel) => {
        throw new Error(`denied ${channel}`);
      },
    },
    {
      getSettings: () => settings,
      updateSettings,
      getStatus: () => undefined,
      pickReplayFile: () => Promise.resolve(pick),
    },
  );
  return { handlers, updateSettings };
}

describe("telemetry handlers", () => {
  it("rejects every channel from other senders", async () => {
    const { handlers } = setup(null);
    for (const channel of Object.keys(handlers)) {
      // Sync handlers throw, the async one rejects.
      await expect((async () => handlers[channel]!(otherSender, "auto"))()).rejects.toThrow(
        "denied",
      );
    }
  });

  it("accepts only auto, iracing, lmu and mock as sources", async () => {
    const { handlers, updateSettings } = setup(null);
    const set = handlers[IPC.telemetrySetSource]!;
    expect(await set(settingsSender, "lmu")).toEqual({ source: "lmu", replayPath: null });
    for (const bad of ["replay", "nope", 3, null, undefined, { source: "mock" }]) {
      await set(settingsSender, bad);
    }
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it("leaves the view unchanged when the replay pick is cancelled", async () => {
    const { handlers, updateSettings } = setup(null);
    expect(await handlers[IPC.telemetryPickReplay]!(settingsSender)).toEqual({
      source: "auto",
      replayPath: null,
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("switches to replay with the picked file", async () => {
    const { handlers } = setup("/tmp/lap.ovfx");
    expect(await handlers[IPC.telemetryPickReplay]!(settingsSender)).toEqual({
      source: "replay",
      replayPath: "/tmp/lap.ovfx",
    });
  });

  it("returns null while there is no status", () => {
    const { handlers } = setup(null);
    expect(handlers[IPC.telemetryGetStatus]!(settingsSender)).toBeNull();
  });
});
