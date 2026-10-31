import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "../../shared/app-settings-types";
import { IPC } from "../../shared/types";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { appSettingsHandlers, applyLoginItem } = await import("./app-settings");

const settingsSender = { id: "s" } as unknown as WebContents;
const overlaySender = { id: "o" } as unknown as WebContents;
const strangerSender = { id: "x" } as unknown as WebContents;

function setup() {
  const update = vi.fn(() => DEFAULT_APP_SETTINGS);
  const handlers = appSettingsHandlers(
    {
      isSettingsSender: (s) => s === settingsSender,
      isOverlaySender: (s) => s === overlaySender,
      deny: (channel) => {
        throw new Error(`denied ${channel}`);
      },
    },
    { load: () => DEFAULT_APP_SETTINGS, update },
  );
  return { handlers, update };
}

describe("app settings handlers", () => {
  it("lets settings and overlay windows read, others not", () => {
    const { handlers } = setup();
    const get = handlers[IPC.appSettingsGet]!;
    expect(get(settingsSender)).toBe(DEFAULT_APP_SETTINGS);
    expect(get(overlaySender)).toBe(DEFAULT_APP_SETTINGS);
    expect(() => get(strangerSender)).toThrow("denied");
  });

  it("lets only the settings window update", () => {
    const { handlers, update } = setup();
    const set = handlers[IPC.appSettingsUpdate]!;
    set(settingsSender, { general: { autoHide: true } });
    expect(update).toHaveBeenCalledWith({ general: { autoHide: true } });
    expect(() => set(overlaySender, {})).toThrow("denied");
  });
});

describe("applyLoginItem", () => {
  const mk = (isPackaged: boolean, platform: NodeJS.Platform) => ({
    isPackaged,
    platform,
    setLoginItem: vi.fn(),
    log: vi.fn(),
  });

  it("sets the login item only when packaged on Windows", () => {
    const win = mk(true, "win32");
    expect(applyLoginItem(win, true)).toBe(true);
    expect(win.setLoginItem).toHaveBeenCalledWith(true);
    applyLoginItem(win, false);
    expect(win.setLoginItem).toHaveBeenLastCalledWith(false);

    for (const deps of [mk(false, "win32"), mk(true, "linux")]) {
      expect(applyLoginItem(deps, true)).toBe(false);
      expect(deps.setLoginItem).not.toHaveBeenCalled();
      expect(deps.log).toHaveBeenCalled();
    }
  });
});
