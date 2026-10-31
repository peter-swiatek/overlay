import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TELEMETRY_SETTINGS } from "./telemetry-settings";
import { buildAboutItem, buildDataSourceMenu, buildUpdateItems, trayTooltip } from "./tray-model";
import type { UpdateState } from "./updater";

const actions = () => ({ select: vi.fn(), pickReplayFile: vi.fn() });

describe("data source menu", () => {
  it("lists Auto, iRacing, LMU, Replay file, Mock as radio items", () => {
    const menu = buildDataSourceMenu(DEFAULT_TELEMETRY_SETTINGS, actions());
    expect(menu.map((i) => i.label)).toEqual(["Auto", "iRacing", "LMU", "Replay file...", "Mock"]);
    expect(menu.every((i) => i.type === "radio")).toBe(true);
  });

  it("checks exactly the current choice", () => {
    for (const [source, label] of [
      ["auto", "Auto"],
      ["iracing", "iRacing"],
      ["lmu", "LMU"],
      ["replay", "Replay file..."],
      ["mock", "Mock"],
    ] as const) {
      const menu = buildDataSourceMenu({ ...DEFAULT_TELEMETRY_SETTINGS, source }, actions());
      expect(menu.filter((i) => i.checked).map((i) => i.label)).toEqual([label]);
    }
  });

  it("selects directly, but asks for a file for replay", () => {
    const a = actions();
    const menu = buildDataSourceMenu(DEFAULT_TELEMETRY_SETTINGS, a);
    const click = (label: string): void => menu.find((i) => i.label === label)?.click();
    click("iRacing");
    click("LMU");
    click("Auto");
    click("Mock");
    expect(a.select.mock.calls.map((c) => c[0])).toEqual(["iracing", "lmu", "auto", "mock"]);
    expect(a.pickReplayFile).not.toHaveBeenCalled();
    click("Replay file...");
    expect(a.pickReplayFile).toHaveBeenCalledOnce();
    expect(a.select).toHaveBeenCalledTimes(4);
  });
});

describe("version in the tray", () => {
  it("shows the display version in the tooltip and a disabled About item", () => {
    const build = { displayVersion: "0.1.0-dev.123+abc1234" };
    expect(trayTooltip(build)).toBe("Overlay 0.1.0-dev.123+abc1234");
    expect(buildAboutItem(build)).toEqual({
      label: "Overlay 0.1.0-dev.123+abc1234",
      enabled: false,
    });
  });
});

describe("update items", () => {
  const mkActions = () => ({
    checkNow: vi.fn(),
    setAllowPrerelease: vi.fn(),
    restartToUpdate: vi.fn(),
  });
  const items = (state: UpdateState, allowPrerelease = false, enabled = true, a = mkActions()) =>
    buildUpdateItems({ enabled, state, allowPrerelease }, a);

  it("shows a single disabled item for local builds", () => {
    expect(items({ kind: "idle" }, false, false)).toEqual([
      { label: "Updates: not available in local builds", enabled: false },
    ]);
  });

  it("idle: enabled check item and an unchecked test-builds checkbox", () => {
    const a = mkActions();
    const [check, test] = items({ kind: "idle" }, false, true, a);
    expect(check).toMatchObject({ label: "Check for updates", enabled: true });
    expect(test).toMatchObject({ label: "Include test builds", type: "checkbox", checked: false });
    check?.click?.();
    test?.click?.();
    expect(a.checkNow).toHaveBeenCalledOnce();
    expect(a.setAllowPrerelease).toHaveBeenCalledWith(true);
  });

  it("reflects the persisted test-builds setting", () => {
    const a = mkActions();
    const [, test] = items({ kind: "idle" }, true, true, a);
    expect(test?.checked).toBe(true);
    test?.click?.();
    expect(a.setAllowPrerelease).toHaveBeenCalledWith(false);
  });

  it("checking and downloading disable the check item", () => {
    expect(items({ kind: "checking" })[0]).toMatchObject({ label: "Checking...", enabled: false });
    expect(items({ kind: "available", version: "0.2.0" })[0]).toMatchObject({
      label: "Downloading v0.2.0...",
      enabled: false,
    });
  });

  it("up to date and error show in the label and stay clickable", () => {
    expect(items({ kind: "up-to-date" })[0]).toMatchObject({ label: "Up to date", enabled: true });
    expect(items({ kind: "error", message: "x" })[0]).toMatchObject({
      label: "Update check failed",
      enabled: true,
    });
  });

  it("downloaded adds a restart item that restarts", () => {
    const a = mkActions();
    const list = items({ kind: "downloaded", version: "0.2.0" }, false, true, a);
    expect(list.map((i) => i.label)).toEqual([
      "Update v0.2.0 ready",
      "Include test builds",
      "Restart to update (v0.2.0)",
    ]);
    expect(list[0]?.enabled).toBe(false);
    list[2]?.click?.();
    expect(a.restartToUpdate).toHaveBeenCalledOnce();
  });
});
