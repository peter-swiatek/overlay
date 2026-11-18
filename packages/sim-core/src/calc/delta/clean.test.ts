import { describe, expect, it } from "vitest";
import { LapCleanliness, type CleanSample } from "./clean";

function s(over: Partial<CleanSample> = {}): CleanSample {
  return {
    incidentCount: 0,
    trackSurface: "onTrack",
    onPitRoad: false,
    inPitStall: false,
    ...over,
  };
}

describe("LapCleanliness", () => {
  it("is clean on an uneventful lap", () => {
    const c = new LapCleanliness();
    c.start(s());
    c.sample(s());
    expect(c.clean).toBe(true);
    expect(c.outLap).toBe(false);
    expect(c.touchedPitRoad).toBe(false);
  });

  it("is dirty after an incident rise", () => {
    const c = new LapCleanliness();
    c.start(s({ incidentCount: 4 }));
    c.sample(s({ incidentCount: 5 }));
    expect(c.clean).toBe(false);
  });

  it("is dirty after going off track, once", () => {
    const c = new LapCleanliness();
    c.start(s());
    c.sample(s({ trackSurface: "offTrack" }));
    c.sample(s());
    expect(c.clean).toBe(false);
  });

  it("is dirty after touching pit road, and not an out lap then", () => {
    const c = new LapCleanliness();
    c.start(s());
    c.sample(s({ onPitRoad: true }));
    expect(c.clean).toBe(false);
    expect(c.touchedPitRoad).toBe(true);
    expect(c.outLap).toBe(false);
  });

  it("flags an out lap that starts on pit road or in the stall", () => {
    const a = new LapCleanliness();
    a.start(s({ onPitRoad: true }));
    expect(a.outLap).toBe(true);
    expect(a.clean).toBe(false);
    const b = new LapCleanliness();
    b.start(s({ inPitStall: true }));
    expect(b.outLap).toBe(true);
    expect(b.touchedPitRoad).toBe(true);
  });

  it("does not count a falling incident count, and rebases to it", () => {
    const c = new LapCleanliness();
    c.start(s({ incidentCount: 6 }));
    c.sample(s({ incidentCount: 0 }));
    expect(c.clean).toBe(true);
    c.sample(s({ incidentCount: 1 }));
    expect(c.clean).toBe(false);
  });

  it("never dirties on a null count", () => {
    const c = new LapCleanliness();
    c.start(s({ incidentCount: null }));
    c.sample(s({ incidentCount: null }));
    expect(c.clean).toBe(true);
    c.sample(s({ incidentCount: 3 }));
    expect(c.clean).toBe(true);
    c.sample(s({ incidentCount: null }));
    c.sample(s({ incidentCount: 4 }));
    expect(c.clean).toBe(false);
  });

  it("resets on start", () => {
    const c = new LapCleanliness();
    c.start(s());
    c.sample(s({ trackSurface: "offTrack" }));
    c.start(s());
    expect(c.clean).toBe(true);
  });
});
