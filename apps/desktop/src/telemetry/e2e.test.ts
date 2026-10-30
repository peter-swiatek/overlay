import { describe, expect, it } from "vitest";
import { Deriver, type TelemetryFrame } from "@overlay/sim-core";
import { TelemetryEngine } from "./engine";
import { ReplayTelemetrySource } from "./replay";
import { IRACING_RACE_START, readRecords } from "./testing";

/** The iRacing race-start slice through the replay source, the engine and its Deriver. */
describe("end to end: replay source and engine on the iRacing race-start slice", () => {
  it("goes formation to racing, records one invalid lap at the S/F crossing and orders gaps", async () => {
    const records = await readRecords(IRACING_RACE_START);
    const deriver = new Deriver();
    const frames: TelemetryFrame[] = [];
    let crossingFrame: number | null = null;
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (finish = resolve));

    const engine = new TelemetryEngine({
      live: {},
      deriver,
      createReplay: () => ReplayTelemetrySource.fromRecords(records),
      createMock: () => ReplayTelemetrySource.fromRecords(records),
      publish: (frame) => {
        if (frame.status === "waiting") return finish(); // the replay ended
        frames.push(frame);
        if (crossingFrame === null && deriver.fuelTracker.lapRecords.length > 0) {
          crossingFrame = frames.length - 1;
        }
      },
    });
    engine.setSource({ source: "replay", replayPath: "in-memory" });
    engine.start();
    await done;
    engine.stop();

    expect(frames.length).toBeGreaterThan(1000);
    expect(frames.every((f) => f.status === "live" && f.source === "replay")).toBe(true);

    const phases: string[] = [];
    for (const f of frames) {
      const phase = f.state.session.phase;
      if (phase !== null && phases[phases.length - 1] !== phase) phases.push(phase);
    }
    expect(phases).toEqual(["formation", "racing"]);

    // Exactly one invalid lap, recorded on the frame where the player's lap counter first exists.
    const records1 = deriver.fuelTracker.lapRecords;
    expect(records1).toHaveLength(1);
    expect(records1[0]?.valid).toBe(false);
    expect(["paceLap", "unknownStart"]).toContain(records1[0]?.reason);
    expect(crossingFrame).not.toBeNull();
    const playerLaps = (i: number): number | null => {
      const f = frames[i];
      return f?.state.cars.find((c) => c.carIdx === f.state.playerCarIdx)?.lapsCompleted ?? null;
    };
    expect(playerLaps((crossingFrame ?? 0) - 1)).toBeNull();
    expect(playerLaps(crossingFrame ?? 0)).toBe(0);
    // Near the S/F crossing in the data (816.1 s into the source recording; the slice starts at 805 s).
    const crossingTimeS = 805 + ((crossingFrame ?? 0) + 0.5) / 57;
    expect(Math.abs(crossingTimeS - 816.1)).toBeLessThan(0.5);

    // Gap order is the order of the cars around the player's lap distance.
    const final = frames[frames.length - 1] as TelemetryFrame;
    const player = final.state.cars.find((c) => c.carIdx === final.state.playerCarIdx);
    const pp = player?.lapDistPct ?? 0;
    const ahead = (pct: number): number => ((pct - pp + 0.5 + 10) % 1) - 0.5;
    const onTrack = final.derived.gaps
      .map((g) => ({ g, car: final.state.cars.find((c) => c.carIdx === g.carIdx) }))
      .filter((x) => x.car?.isOnTrack === true && x.car.lapDistPct !== null && x.g.gapS !== null);
    expect(onTrack.length).toBeGreaterThan(3);
    const byGap = [...onTrack].sort((a, b) => (a.g.gapS ?? 0) - (b.g.gapS ?? 0));
    const byPct = [...onTrack].sort(
      (a, b) => ahead(b.car?.lapDistPct ?? 0) - ahead(a.car?.lapDistPct ?? 0),
    );
    expect(byGap.map((x) => x.g.carIdx)).toEqual(byPct.map((x) => x.g.carIdx));
  }, 60_000);
});
