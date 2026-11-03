import type { Car, SimState } from "../../model";
import type { GapReferenceLap } from "../gaps";
import { bestLapGap, lapTimeChain, raceGap } from "./gap";
import { hasOfficialOrder, officialOrder, raceOrder, type OrderCar } from "./order";
import { newPitHistory, stepPit, stintLaps, type PitHistory } from "./pit";
import { strengthOfField } from "./sof";
import type { Standings, StandingsEntry, StandingsGap, StandingsInputs } from "./types";

export * from "./types";
export { strengthOfField } from "./sof";
export { officialOrder, raceOrder, type OrderCar } from "./order";
export { raceGap, bestLapGap, lapTimeChain } from "./gap";
export { newPitHistory, stepPit, stintLaps, type PitHistory } from "./pit";

type Phase = NonNullable<SimState["session"]["phase"]>;

function isRacePhase(phase: Phase | null): boolean {
  return phase === "racing" || phase === "checkered" || phase === "cooldown";
}

/**
 * lapsCompleted + lapDistPct for a car that is in the world; null otherwise. In a race a missing
 * lap count with a known lap fraction is the grid before the first S/F crossing (iRacing reports
 * -1 there, which the adapter turns into null), so the car is a lap behind: progress = pct - 1.
 */
export function progressLaps(car: Car, race = false): number | null {
  if (!car.connected) return null;
  const { lapsCompleted, lapDistPct: pct } = car;
  if (pct === null || !Number.isFinite(pct) || pct < 0) return null;
  const laps = lapsCompleted ?? (race ? -1 : null);
  if (laps === null) return null;
  return laps + pct;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

interface ClassAcc {
  leader: number;
  prev: number;
  rank: number;
  bestS: number | null;
  ratings: (number | null)[];
}

/**
 * Standings for every non-pace car, once per frame. The pure definitions live in the sibling
 * files; this class only keeps the history they need (pit and stint state, the start grid and the
 * finishing order).
 */
export class StandingsTracker {
  private pit = new Map<number, PitHistory>();
  private prevLaps = new Map<number, number>();
  private finishRank = new Map<number, number>();
  /** Progress frozen at the line crossing, per finished car. */
  private finishProgress = new Map<number, number>();
  /** Progress of every car in the previous frame, to find who led before a crossing. */
  private prevProgress = new Map<number, number>();
  /** Last known progress per car, kept for cars that leave the world after the flag. */
  private lastProgress = new Map<number, number>();
  /** The leader has taken the flag, so crossings now count as finishes. */
  private leaderFinished = false;
  private startPositions = new Map<number, number>();
  private startRecorded = false;

  reset(): void {
    this.pit.clear();
    this.prevLaps.clear();
    this.finishRank.clear();
    this.finishProgress.clear();
    this.prevProgress.clear();
    this.lastProgress.clear();
    this.leaderFinished = false;
    this.startPositions.clear();
    this.startRecorded = false;
  }

  /**
   * The flag falls when the clock runs out, but a car only finishes when it crosses the line after
   * the leader has. Cars crossing before that (a lapped car passing the line during the leader's
   * last lap) keep racing. The leader is whoever was furthest ahead in the previous frame.
   */
  private acceptFinishers(
    cars: readonly Car[],
    crossed: readonly number[],
    progress: readonly (number | null)[],
  ): void {
    if (crossed.length === 0) return;
    if (!this.leaderFinished) {
      let leader = -1;
      let best = -Infinity;
      for (let i = 0; i < cars.length; i++) {
        const before = this.prevProgress.get((cars[i] as Car).carIdx);
        if (progress[i] !== null && before !== undefined && before > best) {
          best = before;
          leader = i;
        }
      }
      if (leader < 0 || !crossed.includes(leader)) return;
      this.leaderFinished = true;
      this.finish(cars, leader);
    }
    const rest = crossed.filter((i) => !this.finishRank.has((cars[i] as Car).carIdx));
    rest.sort((a, b) => (cars[a]?.position ?? Infinity) - (cars[b]?.position ?? Infinity) || a - b);
    for (const i of rest) this.finish(cars, i);
  }

  private finish(cars: readonly Car[], i: number): void {
    const car = cars[i] as Car;
    this.finishRank.set(car.carIdx, this.finishRank.size + 1);
    // The counter has just ticked, so the car is at the line: its distance is whole laps.
    this.finishProgress.set(car.carIdx, car.lapsCompleted as number);
  }

  next(state: SimState, inputs: StandingsInputs): Standings | null {
    if (!state.connected) return null;
    const cars: Car[] = [];
    for (const car of state.cars) if (car.isPaceCar !== true) cars.push(car);
    const n = cars.length;
    if (n === 0) return null;

    const phase = state.session.phase;
    const race = state.session.type === "race" && isRacePhase(phase);
    const finishing = race && (phase === "checkered" || phase === "cooldown");

    // History first, so this frame's order already sees a car that just crossed the line.
    const progress: (number | null)[] = new Array<number | null>(n);
    const crossed: number[] = [];
    for (let i = 0; i < n; i++) {
      const car = cars[i] as Car;
      progress[i] = progressLaps(car, state.session.type === "race");
      let h = this.pit.get(car.carIdx);
      if (!h) this.pit.set(car.carIdx, (h = newPitHistory()));
      stepPit(h, car.onPitRoad, car.lapsCompleted, car.connected, car.inPitStall);
      const prev = this.prevLaps.get(car.carIdx);
      if (
        finishing &&
        car.lapsCompleted !== null &&
        prev !== undefined &&
        car.lapsCompleted > prev &&
        !this.finishRank.has(car.carIdx)
      ) {
        crossed.push(i);
      }
      if (car.lapsCompleted !== null) this.prevLaps.set(car.carIdx, car.lapsCompleted);
    }
    if (finishing) this.acceptFinishers(cars, crossed, progress);
    // A finisher's distance is what it had at the line, whatever the sim reports afterwards (the
    // lap counter resets and the car leaves the world).
    for (let i = 0; i < n; i++) {
      const frozen = this.finishProgress.get((cars[i] as Car).carIdx);
      if (frozen !== undefined) progress[i] = frozen;
    }
    this.prevProgress.clear();
    for (let i = 0; i < n; i++) {
      const p = progress[i];
      if (p === null || p === undefined) continue;
      this.prevProgress.set((cars[i] as Car).carIdx, p);
      this.lastProgress.set((cars[i] as Car).carIdx, p);
    }
    if (finishing) {
      // A car that leaves the world after the flag (back to the garage) keeps its place.
      for (let i = 0; i < n; i++) {
        if (progress[i] === null)
          progress[i] = this.lastProgress.get((cars[i] as Car).carIdx) ?? null;
      }
    }

    const best: (number | null)[] = new Array<number | null>(n);
    const orderCars: OrderCar[] = new Array<OrderCar>(n);
    for (let i = 0; i < n; i++) {
      const car = cars[i] as Car;
      best[i] = positiveOrNull(car.bestLapS) ?? positiveOrNull(inputs.bestLapS(car.carIdx));
      orderCars[i] = {
        carIdx: car.carIdx,
        position: car.position,
        progress: progress[i] ?? null,
        bestLapS: best[i] ?? null,
        finishRank: this.finishRank.get(car.carIdx) ?? 0,
      };
    }
    // From cooldown the sim's own results are final; use them whenever it provides positions.
    const official = !race || (phase === "cooldown" && orderCars.some((c) => c.position !== null));
    const order = official ? officialOrder(orderCars) : raceOrder(orderCars);

    // Bests: the sim's own values, then the tracker's laps as a fallback.
    let sessionBest: number | null = null;
    const classes = new Map<string, ClassAcc>();
    for (let i = 0; i < n; i++) {
      const car = cars[i] as Car;
      const key = car.classId ?? "";
      let acc = classes.get(key);
      if (!acc) {
        acc = { leader: -1, prev: -1, rank: 0, bestS: null, ratings: [] };
        classes.set(key, acc);
      }
      acc.ratings.push(car.iRating);
      const simBest = positiveOrNull(car.bestLapS);
      if (simBest !== null) {
        if (sessionBest === null || simBest < sessionBest) sessionBest = simBest;
        if (acc.bestS === null || simBest < acc.bestS) acc.bestS = simBest;
      }
    }
    sessionBest ??= positiveOrNull(inputs.sessionBestLapS());
    const classBestLapS: Record<string, number> = {};
    const classSof: Record<string, number> = {};
    for (const [key, acc] of classes) {
      acc.bestS ??= positiveOrNull(inputs.classBestLapS(key));
      if (acc.bestS !== null) classBestLapS[key] = acc.bestS;
      const sof = strengthOfField(acc.ratings);
      if (sof !== null) classSof[key] = sof;
    }

    // The start grid is the live order at the first racing frame with known progress. A recording
    // that joins a race in progress (somebody already a lap in) has no start positions.
    let recordStart = false;
    if (race && phase === "racing" && !this.startRecorded) {
      let lead: number | null = null;
      for (const p of progress) if (p !== null && (lead === null || p > lead)) lead = p;
      if (lead !== null) {
        this.startRecorded = true;
        recordStart = lead < 1;
      }
    }

    const entries: StandingsEntry[] = new Array<StandingsEntry>(n);
    for (let i = 0; i < n; i++) {
      const car = cars[i] as Car;
      const h = this.pit.get(car.carIdx) as PitHistory;
      const carBest = positiveOrNull(car.bestLapS);
      entries[i] = {
        carIdx: car.carIdx,
        position: car.position,
        classPosition: car.classPosition,
        livePosition: null,
        liveClassPosition: null,
        progressLaps: progress[i] ?? null,
        gapToLeader: null,
        gapToClassLeader: null,
        interval: null,
        avgLapS: positiveOrNull(inputs.averageLapS(car.carIdx)),
        sessionBest: carBest !== null && carBest === sessionBest,
        classBest: carBest !== null && carBest === (classBestLapS[car.classId ?? ""] ?? null),
        pitStops: h.pitStops,
        lastPitLap: h.lastPitLap,
        stintLaps: stintLaps(h, this.finishProgress.get(car.carIdx) ?? car.lapsCompleted),
        prevStintLaps: h.prevStintLaps,
        startPosition: this.startPositions.get(car.carIdx) ?? null,
        iRatingChange: null,
      };
    }

    // Per-car reference lap, resolved at most once per frame (a car is "behind" in up to 3 gaps).
    const refs = new Map<number, GapReferenceLap | undefined>();
    const gap = (ahead: number, behind: number): StandingsGap => {
      if (!race) return bestLapGap(best[behind] ?? null, best[ahead] ?? null);
      const a = cars[ahead] as Car;
      const c = cars[behind] as Car;
      let ref = refs.get(c.carIdx);
      if (ref === undefined && !refs.has(c.carIdx)) {
        ref = inputs.carReference(c.carIdx) ?? inputs.trackReference(c.classId ?? "");
        refs.set(c.carIdx, ref);
      }
      const fallbackLapS = lapTimeChain(
        inputs.averageLapS(c.carIdx),
        best[behind],
        classBestLapS[c.classId ?? ""],
        sessionBest,
      );
      const pa = progress[ahead];
      const pc = progress[behind];
      if (pa === null || pc === null || pa === undefined || pc === undefined) {
        return { laps: 0, seconds: null };
      }
      return raceGap(pa, a.lapDistPct as number, pc, c.lapDistPct as number, ref, fallbackLapS);
    };

    // Walk the live order once: ranks, class leaders and the car ahead in the class.
    let leader = -1;
    let rank = 0;
    for (const i of order) {
      const car = cars[i] as Car;
      const ranked = official ? hasOfficialOrder(orderCars[i] as OrderCar) : progress[i] !== null;
      if (!ranked) continue;
      const e = entries[i] as StandingsEntry;
      const acc = classes.get(car.classId ?? "") as ClassAcc;
      rank += 1;
      acc.rank += 1;
      e.livePosition = rank;
      e.liveClassPosition = acc.rank;
      if (leader < 0) {
        leader = i;
        e.gapToLeader = { laps: 0, seconds: 0 };
      } else {
        e.gapToLeader = gap(leader, i);
      }
      if (acc.leader < 0) {
        acc.leader = i;
        e.gapToClassLeader = { laps: 0, seconds: 0 };
      } else {
        e.gapToClassLeader = gap(acc.leader, i);
        e.interval = gap(acc.prev, i);
      }
      acc.prev = i;
      if (recordStart) {
        this.startPositions.set(car.carIdx, rank);
        e.startPosition = rank;
      }
    }

    return {
      entries,
      sessionBestLapS: sessionBest,
      classBestLapS,
      sof: strengthOfField(cars.map((c) => c.iRating)),
      classSof,
    };
  }
}
