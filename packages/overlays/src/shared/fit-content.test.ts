import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "../manifests";
import { fitContentOf } from "./fit-content";

describe("fitContentOf", () => {
  it("defaults to none", () => {
    expect(fitContentOf({ table: false }, {})).toBe("none");
  });
  it("returns the manifest's axis", () => {
    expect(fitContentOf({ table: false, fitContent: "both" }, {})).toBe("both");
    expect(fitContentOf({ table: false, fitContent: "height" }, {})).toBe("height");
  });
  it("lets a table fit its height only", () => {
    expect(fitContentOf({ table: true, fitContent: "both" }, {})).toBe("height");
  });
  it("turns off while the off option has its value", () => {
    const m = {
      table: true,
      fitContent: "height" as const,
      fitContentOffWhen: { key: "show-all", value: true },
    };
    expect(fitContentOf(m, { "show-all": true })).toBe("none");
    expect(fitContentOf(m, { "show-all": false })).toBe("height");
  });
});

describe("overlay fit axes", () => {
  const axes = Object.fromEntries(OVERLAY_MANIFESTS.map((m) => [m.id, m.fitContent ?? "none"]));
  it("fits the height of the overlays built from stacked sections or rows set in the settings", () => {
    for (const id of [
      "fuel",
      "delta-bar",
      "weather",
      "tyres",
      "lap-times",
      "incidents",
      "incident-log",
      "setup-compare",
      "battle-box",
      "relative",
      "leaderboard",
    ]) {
      expect(axes[id], id).toBe("height");
    }
  });
  it("leaves the user's size on overlays whose content scales with the window or is fixed geometry", () => {
    for (const id of [
      "inputs",
      "radar",
      "mini-map",
      "track-map",
      "flat-track-map",
      "spotter",
      "compact-hud",
      "telemetry-strip",
      "car-status",
      "vehicle-damage",
      "digi-flag",
      "incident-bar",
      "pit-speed",
      "data-frames",
      "rejoin-helper",
      "overtake-alert",
      "twitch-chat",
      "webview",
    ]) {
      expect(axes[id], id).toBe("none");
    }
  });
  it("lets the Leaderboard's Show all hand the height back to the user", () => {
    const lb = OVERLAY_MANIFESTS.find((m) => m.id === "leaderboard");
    expect(lb && fitContentOf(lb, { "show-all": true })).toBe("none");
    expect(lb && fitContentOf(lb, { "show-all": false })).toBe("height");
  });
  it("names only real option keys in fitContentOffWhen", () => {
    for (const m of OVERLAY_MANIFESTS) {
      if (m.fitContentOffWhen) {
        expect(m.settings.map((s) => s.key)).toContain(m.fitContentOffWhen.key);
      }
    }
  });
});
