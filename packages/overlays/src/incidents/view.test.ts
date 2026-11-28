import type { TelemetryFrame } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { incidentBar, incidentStatus, incidentsView, SAMPLE_INCIDENTS_VIEW } from "./view";

function frame(
  opts: {
    own?: number | null;
    team?: number | null;
    teamRacing?: boolean | null;
    pen?: number | null;
    dq?: number | null;
  } = {},
): TelemetryFrame {
  return fixtureFrame({
    cars: [{ carIdx: 0 }],
    playerCarIdx: 0,
    session: {
      incidentLimit: opts.dq === undefined ? 25 : opts.dq,
      incidentPenaltyLimit: opts.pen === undefined ? 17 : opts.pen,
      teamRacing: opts.teamRacing ?? false,
    },
    player: {
      incidentCount: opts.own === undefined ? 0 : opts.own,
      teamIncidentCount: opts.team === undefined ? null : opts.team,
    },
  });
}

describe("incidentStatus", () => {
  it.each([
    [0, "clean"],
    [1, "caution"],
    [16, "caution"],
    [17, "penalty"],
    [24, "penalty"],
    [25, "dq"],
    [40, "dq"],
  ] as const)("%i of 17 / 25 is %s", (n, status) => {
    expect(incidentStatus(n, 17, 25)).toBe(status);
  });

  it("stays at caution without limits and skips a missing penalty limit", () => {
    expect(incidentStatus(80, null, null)).toBe("caution");
    expect(incidentStatus(20, null, 25)).toBe("caution");
    expect(incidentStatus(25, null, 25)).toBe("dq");
    expect(incidentStatus(20, 17, null)).toBe("penalty");
  });
});

describe("incidentsView", () => {
  it("is null without a live frame or an incident count", () => {
    expect(incidentsView(null)).toBeNull();
    const f = frame();
    f.status = "waiting";
    expect(incidentsView(f)).toBeNull();
    expect(incidentsView(frame({ own: null }))).toBeNull();
  });

  it("gives the count, limits and status", () => {
    expect(incidentsView(frame({ own: 4 }))).toEqual({
      count: 4,
      team: false,
      penaltyLimit: 17,
      dqLimit: 25,
      status: "caution",
    });
  });

  it("drops unknown, zero and unreachable limits", () => {
    const v = incidentsView(frame({ pen: null, dq: null }));
    expect(v?.penaltyLimit).toBeNull();
    expect(v?.dqLimit).toBeNull();
    expect(incidentsView(frame({ pen: 0 }))?.penaltyLimit).toBeNull();
    // A penalty limit at or past the DQ limit never applies.
    expect(incidentsView(frame({ pen: 30, dq: 25 }))?.penaltyLimit).toBeNull();
    expect(incidentsView(frame({ pen: 25, dq: 25 }))?.penaltyLimit).toBeNull();
  });

  it("copes with a replayed state that lacks the newer fields", () => {
    const f = frame({ own: 3 });
    const session = f.state.session as unknown as Record<string, unknown>;
    delete session["incidentPenaltyLimit"];
    delete session["teamRacing"];
    delete (f.state.player as unknown as Record<string, unknown>)["teamIncidentCount"];
    expect(incidentsView(f)).toMatchObject({ count: 3, penaltyLimit: null, dqLimit: 25 });
  });

  it("uses the team total in team events and the own count otherwise", () => {
    expect(incidentsView(frame({ own: 3, team: 9, teamRacing: true }))).toMatchObject({
      count: 9,
      team: true,
    });
    expect(incidentsView(frame({ own: 3, team: 9, teamRacing: false }))).toMatchObject({
      count: 3,
      team: false,
    });
    // No team count reported: fall back to the own count.
    expect(incidentsView(frame({ own: 3, team: null, teamRacing: true }))).toMatchObject({
      count: 3,
      team: false,
    });
  });
});

describe("incidentBar", () => {
  const view = (count: number, penaltyLimit: number | null, dqLimit: number | null) => ({
    ...SAMPLE_INCIDENTS_VIEW,
    count,
    penaltyLimit,
    dqLimit,
  });

  it("splits the bar at the penalty limit and fills the first track first", () => {
    const [pen, dq] = incidentBar(view(0, 17, 25));
    expect(pen).toEqual({ kind: "pen", share: 17 / 25, fill: 0 });
    expect(dq).toEqual({ kind: "dq", share: 8 / 25, fill: 0 });
    const half = incidentBar(view(8.5, 17, 25));
    expect(half[0]?.fill).toBeCloseTo(0.5, 9);
    expect(half[1]?.fill).toBe(0);
    const past = incidentBar(view(21, 17, 25));
    expect(past[0]?.fill).toBe(1);
    expect(past[1]?.fill).toBe(0.5);
    expect(incidentBar(view(30, 17, 25)).map((s) => s.fill)).toEqual([1, 1]);
  });

  it("is one track with one limit and none without limits", () => {
    expect(incidentBar(view(5, null, 25))).toEqual([{ kind: "pen", share: 1, fill: 0.2 }]);
    expect(incidentBar(view(5, 10, null))).toEqual([{ kind: "pen", share: 1, fill: 0.5 }]);
    expect(incidentBar(view(5, null, null))).toEqual([]);
  });
});
