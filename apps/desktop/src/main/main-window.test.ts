import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../shared/app-settings-types";
import {
  HIDDEN_ARG,
  clampMainWindowState,
  decideClose,
  launchPlan,
  parseMainWindowState,
  revealMainWindow,
  shouldMinimiseOnConnect,
} from "./main-window";

function settings(startHiddenAtLogin: boolean): AppSettings {
  const s = structuredClone(DEFAULT_APP_SETTINGS);
  s.general.startHiddenAtLogin = startHiddenAtLogin;
  return s;
}

describe("revealMainWindow", () => {
  it("maximises before showing, and only when the saved state was maximised", () => {
    const calls: string[] = [];
    const win = {
      maximize: () => void calls.push("maximize"),
      show: () => void calls.push("show"),
      focus: () => void calls.push("focus"),
    };
    revealMainWindow(win, true);
    expect(calls).toEqual(["maximize", "show", "focus"]);
    calls.length = 0;
    revealMainWindow(win, false);
    expect(calls).toEqual(["show", "focus"]);
  });
});

describe("launchPlan", () => {
  it("starts hidden for the login flag when startHiddenAtLogin is on", () => {
    expect(launchPlan(["app.exe", HIDDEN_ARG], settings(true)).showWindow).toBe(false);
  });

  it("shows the window for the login flag when startHiddenAtLogin is off", () => {
    expect(launchPlan(["app.exe", HIDDEN_ARG], settings(false)).showWindow).toBe(true);
  });

  it("always shows the window when started by hand", () => {
    expect(launchPlan(["app.exe"], settings(true)).showWindow).toBe(true);
    expect(launchPlan(["app.exe", "--safe-mode"], settings(true)).showWindow).toBe(true);
  });
});

describe("decideClose", () => {
  it("hides to the tray and shows the notice the first time", () => {
    expect(decideClose({ closeAction: "tray", quitting: false, trayNoticeShown: false })).toEqual({
      hide: true,
      quit: false,
      showNotice: true,
    });
  });

  it("shows the notice only once", () => {
    expect(decideClose({ closeAction: "tray", quitting: false, trayNoticeShown: true })).toEqual({
      hide: true,
      quit: false,
      showNotice: false,
    });
  });

  it("quits when closeAction is quit", () => {
    expect(decideClose({ closeAction: "quit", quitting: false, trayNoticeShown: false })).toEqual({
      hide: false,
      quit: true,
      showNotice: false,
    });
  });

  it("lets the window close while the app is quitting", () => {
    expect(decideClose({ closeAction: "tray", quitting: true, trayNoticeShown: false })).toEqual({
      hide: false,
      quit: false,
      showNotice: false,
    });
  });
});

describe("parseMainWindowState", () => {
  it("accepts a full state and rounds it", () => {
    expect(
      parseMainWindowState({ x: 10.4, y: 20, width: 1200.6, height: 800, maximized: true }),
    ).toEqual({ x: 10, y: 20, width: 1201, height: 800, maximized: true });
  });

  it("drops the position when it is incomplete", () => {
    expect(parseMainWindowState({ x: 10, width: 1200, height: 800 })).toEqual({
      width: 1200,
      height: 800,
      maximized: false,
    });
  });

  it("rejects malformed input", () => {
    expect(parseMainWindowState(null)).toBeUndefined();
    expect(parseMainWindowState({ width: "wide", height: 800 })).toBeUndefined();
    expect(parseMainWindowState({ width: Number.NaN, height: 800 })).toBeUndefined();
  });
});

describe("clampMainWindowState", () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const second = { x: 1920, y: 0, width: 1920, height: 1040 };

  it("defaults to 1280x820 on the primary display", () => {
    expect(clampMainWindowState(undefined, [primary], primary)).toEqual({
      width: 1280,
      height: 820,
      maximized: false,
    });
  });

  it("keeps bounds that fit", () => {
    const state = { x: 100, y: 50, width: 1100, height: 700, maximized: false };
    expect(clampMainWindowState(state, [primary], primary)).toEqual(state);
  });

  it("drops a position that is off every display", () => {
    const state = { x: 5000, y: 4000, width: 1100, height: 700, maximized: false };
    expect(clampMainWindowState(state, [primary], primary)).toEqual({
      width: 1100,
      height: 700,
      maximized: false,
    });
  });

  it("keeps a position on a second display that is still connected", () => {
    const state = { x: 2000, y: 40, width: 1100, height: 700, maximized: false };
    expect(clampMainWindowState(state, [primary, second], primary)).toMatchObject({
      x: 2000,
      y: 40,
    });
  });

  it("pulls a window that hangs off the work area back onto it", () => {
    const state = { x: 1500, y: 800, width: 1280, height: 820, maximized: false };
    const out = clampMainWindowState(state, [primary], primary);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect((out.x ?? 0) + out.width).toBeLessThanOrEqual(1920);
    expect((out.y ?? 0) + out.height).toBeLessThanOrEqual(1040);
  });

  it("never goes below the minimum size", () => {
    const state = { x: 0, y: 0, width: 300, height: 200, maximized: false };
    expect(clampMainWindowState(state, [primary], primary)).toMatchObject({
      width: 1000,
      height: 680,
    });
  });

  it("keeps the maximised flag", () => {
    const state = { width: 1100, height: 700, maximized: true };
    expect(clampMainWindowState(state, [primary], primary).maximized).toBe(true);
  });
});

describe("shouldMinimiseOnConnect", () => {
  it("minimises on the change into live when the setting is on", () => {
    expect(shouldMinimiseOnConnect({ previous: null, next: "live", enabled: true })).toBe(true);
    expect(shouldMinimiseOnConnect({ previous: "waiting", next: "live", enabled: true })).toBe(
      true,
    );
  });

  it("does nothing when the setting is off", () => {
    expect(shouldMinimiseOnConnect({ previous: "waiting", next: "live", enabled: false })).toBe(
      false,
    );
  });

  it("does nothing while already live or when not live", () => {
    expect(shouldMinimiseOnConnect({ previous: "live", next: "live", enabled: true })).toBe(false);
    expect(shouldMinimiseOnConnect({ previous: "live", next: "waiting", enabled: true })).toBe(
      false,
    );
    expect(shouldMinimiseOnConnect({ previous: null, next: "error", enabled: true })).toBe(false);
  });
});
