import { describe, expect, it } from "vitest";
import { MiniSectorRecorder, RollingLapTimes, relativeGap, wrapTimeDiff } from "./index";
import { openIracing, readVar, type IrVar } from "./testHelpers/irsdk";

/**
 * Local-only check against a raw iRacing recording (never committed). Set
 * OVERLAY_IRACING_RECORDING to a copy of the Ferrari qualify + race file. Cars are referred to by
 * carIdx only; the recording holds real drivers.
 */
const recording = process.env.OVERLAY_IRACING_RECORDING;

const CARS = 64;
const PLAYER_LAPS = [3, 6, 9];

interface Neighbour {
  carIdx: number;
  /** Our gap (negative = ahead on track). */
  ours: number;
  tier: string;
  estDelta: number;
  f2Delta: number;
  lapDiff: number;
}

interface Crossing {
  lap: number;
  sessionTimeS: number;
  ahead?: Neighbour;
  behind?: Neighbour;
}

function need(vars: Map<string, IrVar>, name: string): IrVar {
  const v = vars.get(name);
  if (!v) throw new Error(`missing var ${name}`);
  return v;
}

describe.skipIf(!recording)("local iRacing recording: relative gaps", () => {
  it("computes sensible gaps against CarIdxEstTime at the player's S/F crossings", async () => {
    const ir = await openIracing(recording as string);
    const v = (name: string) => need(ir.vars, name);
    const sessionTime = v("SessionTime");
    const sessionNum = v("SessionNum");
    const lapPct = v("CarIdxLapDistPct");
    const lap = v("CarIdxLap");
    const onPit = v("CarIdxOnPitRoad");
    const surface = v("CarIdxTrackSurface");
    const cls = v("CarIdxClass");
    const est = v("CarIdxEstTime");
    const f2 = v("CarIdxF2Time");
    const playerIdx = v("PlayerCarIdx");

    // Session 2 is the race (see the YAML session list); earlier sessions are skipped.
    const raceSession = 2;
    const recorder = new MiniSectorRecorder();
    const laps = new RollingLapTimes();
    const crossings: Crossing[] = [];
    const cleanLapsPerCar = new Map<number, number>();
    let prevPlayerLap = -1;
    let samples = 0;

    for await (const s of ir.samples) {
      if (readVar(s.buf, sessionNum) !== raceSession) continue;
      samples++;
      const t = readVar(s.buf, sessionTime);
      const player = readVar(s.buf, playerIdx);
      const pcts: number[] = [];
      const active: boolean[] = [];
      for (let c = 0; c < CARS; c++) {
        const pct = readVar(s.buf, lapPct, c);
        const surf = readVar(s.buf, surface, c);
        pcts.push(pct);
        active.push(pct >= 0 && surf >= 0);
        if (pct < 0) continue;
        const done = recorder.update({
          sessionTimeS: t,
          carIdx: c,
          lap: readVar(s.buf, lap, c),
          lapDistPct: pct,
          onPitRoad: readVar(s.buf, onPit, c) !== 0,
          offTrack: surf <= 0,
          classId: readVar(s.buf, cls, c),
        });
        if (done) {
          laps.record(c, done.lapTimeS, done.clean, done.classId);
          if (done.clean) cleanLapsPerCar.set(c, (cleanLapsPerCar.get(c) ?? 0) + 1);
        }
      }

      const playerLap = readVar(s.buf, lap, player);
      if (playerLap !== prevPlayerLap && PLAYER_LAPS.includes(playerLap) && prevPlayerLap >= 0) {
        crossings.push(
          describeCrossing({ s, playerLap, t, player, pcts, active, onPit, est, f2, lap }),
        );
      }
      prevPlayerLap = playerLap;
    }

    function describeCrossing(ctx: {
      s: { buf: Buffer };
      playerLap: number;
      t: number;
      player: number;
      pcts: number[];
      active: boolean[];
      onPit: IrVar;
      est: IrVar;
      f2: IrVar;
      lap: IrVar;
    }): Crossing {
      const { s, player, pcts, active } = ctx;
      const focusPct = pcts[player] ?? 0;
      let ahead: { c: number; d: number } | undefined;
      let behind: { c: number; d: number } | undefined;
      for (let c = 0; c < CARS; c++) {
        if (c === player || !active[c] || readVar(s.buf, ctx.onPit, c) !== 0) continue;
        // d > 0: car c is ahead of the player on track.
        const raw = (pcts[c] ?? 0) - focusPct;
        const d = raw - Math.floor(raw + 0.5);
        if (d > 0 && (!ahead || d < ahead.d)) ahead = { c, d };
        if (d <= 0 && (!behind || d > behind.d)) behind = { c, d };
      }
      const neighbour = (found: { c: number } | undefined): Neighbour | undefined => {
        if (!found) return undefined;
        const c = found.c;
        const gap = relativeGap(
          { carIdx: player, lapDistPct: pcts[player] ?? 0 },
          { carIdx: c, lapDistPct: pcts[c] ?? 0 },
          {
            targetReference: recorder.carReference(c),
            trackReference: recorder.trackReference(readVar(s.buf, cls, c)),
            lapTimes: {
              targetAverageS: laps.average(c),
              targetBestS: laps.best(c),
              classBestS: laps.classBest(readVar(s.buf, cls, c)),
              sessionBestS: laps.sessionBest(),
            },
          },
        );
        const lapTimeS = gap.tier === "miniSector" ? gap.referenceLapTimeS : gap.lapTimeS;
        const estDiff = readVar(s.buf, ctx.est, player) - readVar(s.buf, ctx.est, c);
        const f2Diff = readVar(s.buf, ctx.f2, c) - readVar(s.buf, ctx.f2, player);
        return {
          carIdx: c,
          ours: gap.gapS,
          tier: gap.tier === "miniSector" ? `miniSector/${gap.reference}` : gap.tier,
          estDelta: gap.gapS - wrapTimeDiff(estDiff, lapTimeS),
          f2Delta: gap.gapS - f2Diff,
          lapDiff: readVar(s.buf, ctx.lap, c) - readVar(s.buf, ctx.lap, player),
        };
      };
      const crossing: Crossing = { lap: ctx.playerLap, sessionTimeS: ctx.t };
      const a = neighbour(ahead);
      const b = neighbour(behind);
      if (a) crossing.ahead = a;
      if (b) crossing.behind = b;
      return crossing;
    }

    const fmt = (n?: Neighbour) =>
      n
        ? `car ${n.carIdx}: gap ${n.ours.toFixed(3)} s [${n.tier}], d(EstTime) ${n.estDelta.toFixed(3)}, d(F2Time) ${n.f2Delta.toFixed(3)}, lapDiff ${n.lapDiff}`
        : "none";
    const report = crossings.map(
      (c) =>
        `lap ${c.lap} @${c.sessionTimeS.toFixed(1)}s ahead ${fmt(c.ahead)} | behind ${fmt(c.behind)}`,
    );
    console.log(
      `race samples ${samples}, clean laps per car ${JSON.stringify([...cleanLapsPerCar])}\n${report.join("\n")}`,
    );

    expect(samples).toBeGreaterThan(1000);
    expect(crossings.length).toBeGreaterThan(0);
    for (const c of crossings) {
      for (const n of [c.ahead, c.behind]) {
        if (n) expect(Number.isFinite(n.ours)).toBe(true);
      }
    }
    expect(cleanLapsPerCar.size).toBeGreaterThan(0);
  }, 600_000);
});
