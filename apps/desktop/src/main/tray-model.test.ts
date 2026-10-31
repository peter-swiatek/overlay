import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TELEMETRY_SETTINGS } from "./telemetry-settings";
import { buildDataSourceMenu } from "./tray-model";

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
