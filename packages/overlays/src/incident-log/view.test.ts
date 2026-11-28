import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { incidentLogView, pointsTone, sessionClock, type IncidentLogOptions } from "./view";

const OPTIONS: IncidentLogOptions = {
  fieldEvents: true,
  cornerLabels: true,
  highlightNewest: true,
  rows: 6,
  nameFormat: "f-last",
};

describe("sessionClock", () => {
  it("reads mm:ss under an hour and h:mm:ss from an hour on", () => {
    expect(sessionClock(0)).toBe("00:00");
    expect(sessionClock(226.7)).toBe("03:46");
    expect(sessionClock(1491)).toBe("24:51");
    expect(sessionClock(3723)).toBe("1:02:03");
    expect(sessionClock(-5)).toBe("00:00");
  });
});

describe("pointsTone", () => {
  it("maps points to a tone", () => {
    expect(pointsTone(null)).toBe("none");
    expect(pointsTone(0)).toBe("neutral");
    expect(pointsTone(1)).toBe("warn");
    expect(pointsTone(2)).toBe("loss");
    expect(pointsTone(4)).toBe("loss");
  });
});

describe("incidentLogView", () => {
  it("is null without a live frame", () => {
    expect(incidentLogView(null, OPTIONS)).toBeNull();
    const f = fixtureFrame({ cars: [{ carIdx: 0 }], playerCarIdx: 0 });
    f.status = "waiting";
    expect(incidentLogView(f, OPTIONS)).toBeNull();
  });

  it("has no rows before the deriver publishes a log, and ignores a penalty limit past the DQ limit", () => {
    const f = fixtureFrame({
      cars: [{ carIdx: 0 }],
      playerCarIdx: 0,
      session: { incidentPenaltyLimit: 30, incidentLimit: 25 },
      player: { incidentCount: 0 },
    });
    expect(incidentLogView(f, OPTIONS)).toMatchObject({
      rows: [],
      ownCount: 0,
      driverName: null,
      penaltyLimit: null,
      dqLimit: 25,
    });
  });
});
