import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/types";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

const { createAppStateIpcHandlers, createAppStateNotifier, readAppState } =
  await import("./app-state");

import type { IpcContext } from "./context";

const mainSender = { id: "main" } as unknown as Electron.WebContents;
const overlaySender = { id: "overlay" } as unknown as Electron.WebContents;

function fakeSource(visible = true, editing = false) {
  const source = {
    isVisible: visible,
    isEditMode: editing,
    setVisible: vi.fn((v: boolean) => {
      source.isVisible = v;
    }),
    setEditMode: vi.fn((e: boolean) => {
      source.isEditMode = e;
    }),
  };
  return source;
}

function setup(source = fakeSource()) {
  const quit = vi.fn();
  const ctx = {
    isSettingsSender: (s: Electron.WebContents) => s === mainSender,
    deny: (channel: string) => {
      throw new Error(`denied ${channel}`);
    },
  } as unknown as IpcContext;
  const handlers = createAppStateIpcHandlers(ctx, { source: () => source, quit });
  return { handlers, source, quit };
}

describe("app-state handlers", () => {
  it("rejects senders other than the main window", () => {
    const { handlers, quit, source } = setup();
    for (const channel of [IPC.appStateGet, IPC.appStateSet, IPC.appQuit]) {
      expect(() => handlers[channel]!({ sender: overlaySender }, {})).toThrow("denied");
    }
    expect(quit).not.toHaveBeenCalled();
    expect(source.setVisible).not.toHaveBeenCalled();
  });

  it("returns visible and locked (locked is the inverse of edit mode)", () => {
    const { handlers } = setup(fakeSource(false, true));
    expect(handlers[IPC.appStateGet]!({ sender: mainSender })).toEqual({
      overlaysVisible: false,
      overlaysLocked: false,
    });
  });

  it("set visible calls the manager and returns the new state", () => {
    const { handlers, source } = setup();
    const result = handlers[IPC.appStateSet]!({ sender: mainSender }, { overlaysVisible: false });
    expect(source.setVisible).toHaveBeenCalledWith(false);
    expect(result).toEqual({ overlaysVisible: false, overlaysLocked: true });
  });

  it("set locked false turns edit mode on, and true turns it off", () => {
    const { handlers, source } = setup();
    handlers[IPC.appStateSet]!({ sender: mainSender }, { overlaysLocked: false });
    expect(source.setEditMode).toHaveBeenLastCalledWith(true);
    handlers[IPC.appStateSet]!({ sender: mainSender }, { overlaysLocked: true });
    expect(source.setEditMode).toHaveBeenLastCalledWith(false);
  });

  it("ignores values that are already in place and non-boolean junk", () => {
    const { handlers, source } = setup();
    handlers[IPC.appStateSet]!(
      { sender: mainSender },
      { overlaysVisible: true, overlaysLocked: true },
    );
    handlers[IPC.appStateSet]!({ sender: mainSender }, { overlaysVisible: "no" });
    handlers[IPC.appStateSet]!({ sender: mainSender }, null);
    expect(source.setVisible).not.toHaveBeenCalled();
    expect(source.setEditMode).not.toHaveBeenCalled();
  });

  it("quits for the main window", () => {
    const { handlers, quit } = setup();
    handlers[IPC.appQuit]!({ sender: mainSender });
    expect(quit).toHaveBeenCalledOnce();
  });
});

describe("createAppStateNotifier", () => {
  it("broadcasts app-state:changed when the tray or shortcut changes the state", () => {
    const source = fakeSource();
    const send = vi.fn();
    const refresh = vi.fn();
    const notify = createAppStateNotifier(source, send, refresh);

    notify();
    expect(send).toHaveBeenLastCalledWith(IPC.appStateChanged, readAppState(source));

    source.isEditMode = true; // the shortcut flipped it
    notify();
    expect(send).toHaveBeenLastCalledWith(IPC.appStateChanged, {
      overlaysVisible: true,
      overlaysLocked: false,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes the tray but sends nothing when the state is unchanged", () => {
    const source = fakeSource();
    const send = vi.fn();
    const refresh = vi.fn();
    const notify = createAppStateNotifier(source, send, refresh);
    notify();
    notify();
    expect(send).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
