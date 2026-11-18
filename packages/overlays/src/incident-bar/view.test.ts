import type { IncidentAhead } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import {
  fillPct,
  incidentBarText,
  incidentBarView,
  incidentDetail,
  sampleIncidentBarView,
  type IncidentBarOptions,
} from "./view";

const OPTIONS: IncidentBarOptions = { rangeM: 300, redDistanceM: 100, cornerLabels: true };

function incident(patch: Partial<IncidentAhead> = {}): IncidentAhead {
  return {
    carIdx: 2,
    carNumber: "3",
    distanceM: 180,
    kind: "off",
    stopped: false,
    corner: 7,
    ...patch,
  };
}

function frame(ahead: IncidentAhead | null) {
  const f = fixtureFrame({ cars: [{ carIdx: 0 }, { carIdx: 2 }], playerCarIdx: 0 });
  f.derived.incidentAhead = ahead;
  return f;
}

describe("fillPct", () => {
  it("grows from 20% at the range to 50% (the middle) as the car gets closer", () => {
    expect(fillPct(300, 300)).toBe(20);
    expect(fillPct(180, 300)).toBe(36);
    expect(fillPct(75, 300)).toBe(50);
    expect(fillPct(0, 300)).toBe(50);
    expect(fillPct(500, 300)).toBe(20);
    expect(fillPct(10, 0)).toBe(50);
  });
});

describe("incidentDetail / incidentBarText", () => {
  it("names the car without '#', what it is doing and the corner", () => {
    expect(incidentDetail(incident(), true)).toBe("3 OFF T7");
    expect(incidentDetail(incident({ kind: "slow" }), false)).toBe("3 SLOW");
    expect(incidentDetail(incident({ kind: "stopped", corner: null }), true)).toBe("3 STOPPED");
    expect(incidentDetail(incident({ carNumber: null }), true)).toBe("OFF T7");
  });

  it("reads like the design, in whole metres", () => {
    expect(incidentBarText(179.6, "3 OFF T7")).toBe("▲ INCIDENT AHEAD · 180 m (3 OFF T7) ▲");
  });
});

describe("incidentBarView", () => {
  it("is null without a live frame or an incident within range", () => {
    expect(incidentBarView(null, OPTIONS)).toBeNull();
    expect(incidentBarView(frame(null), OPTIONS)).toBeNull();
    expect(incidentBarView(frame(incident({ distanceM: 301 })), OPTIONS)).toBeNull();
    const waiting = frame(incident());
    waiting.status = "waiting";
    expect(incidentBarView(waiting, OPTIONS)).toBeNull();
  });

  it("is yellow for an off-track or slow car, and for a stopped car further than the red distance", () => {
    expect(incidentBarView(frame(incident()), OPTIONS)).toEqual({
      text: "▲ INCIDENT AHEAD · 180 m (3 OFF T7) ▲",
      tone: "yellow",
      fillPct: 36,
    });
    expect(incidentBarView(frame(incident({ kind: "slow", distanceM: 60 })), OPTIONS)?.tone).toBe(
      "yellow",
    );
    const far = incident({ kind: "stopped", stopped: true, distanceM: 140 });
    expect(incidentBarView(frame(far), OPTIONS)?.tone).toBe("yellow");
  });

  it("is red for a stopped car within the red distance, off track or not", () => {
    const near = incident({ kind: "stopped", stopped: true, distanceM: 60, corner: null });
    expect(incidentBarView(frame(near), OPTIONS)).toEqual({
      text: "▲ INCIDENT AHEAD · 60 m (3 STOPPED) ▲",
      tone: "red",
      fillPct: 50,
    });
    const beached = incident({ kind: "off", stopped: true, distanceM: 90 });
    expect(incidentBarView(frame(beached), OPTIONS)?.tone).toBe("red");
    expect(incidentBarView(frame(near), { ...OPTIONS, redDistanceM: 50 })?.tone).toBe("yellow");
  });

  it("follows the range setting", () => {
    const far = frame(incident({ distanceM: 600 }));
    expect(incidentBarView(far, { ...OPTIONS, rangeM: 1000 })?.fillPct).toBe(36);
  });

  it("has a sample matching the design for edit mode", () => {
    expect(sampleIncidentBarView(OPTIONS)).toEqual({
      text: "▲ INCIDENT AHEAD · 180 m (3 OFF T7) ▲",
      tone: "yellow",
      fillPct: 36,
    });
    expect(sampleIncidentBarView({ ...OPTIONS, cornerLabels: false }).text).toContain("(3 OFF)");
  });
});
