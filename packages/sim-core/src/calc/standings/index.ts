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

/** lapsCompleted + lapDistPct for a car that is in the world; null otherwise. */
export function progressLaps(car: Car): number | null {
  if (!car.connected) return null;
  const { lapsCompleted: laps, lapDistPct: pct } = car;
  if (laps === null || pct === null || !Number.isFinite(pct) || pct < 0) return null;
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
  private startPositions = new Map<number, number>();
  private startRecorded = false;
  private prevPhase: Phase | null = null;

  reset(): void {
    this.pit.clear();
    this.prevLaps.clear();
    this.finishRank.clear();
    this.startPositions.clear();
    this.startRecorded = false;
    this.prevPhase = null;
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
    const newFinishers: number[] = [];
    for (let i = 0; i < n; i++) {
      const car = cars[i] as Car;
      progress[i] = progressLaps(car);
      let h = this.pit.get(car.carIdx);
      if (!h) this.pit.set(car.carIdx, (h = newPitHistory()));
      stepPit(h, car.onPitRoad, car.lapsCompleted);
      // A car has finished when its lap count rises after the flag fell. A car that crossed in
      // the frame before the phase changed is missed; kept simple on purpose.
      const prev = this.prevLaps.get(car.carIdx);
      if (
        finishing &&
        car.lapsCompleted !== null &&
        prev !== undefined &&
        car.lapsCompleted > prev &&
        !this.finishRank.has(car.carIdx)
      ) {
        newFinishers.push(i);
      }
      if (car.lapsCompleted !== null) this.prevLaps.set(car.carIdx, car.lapsCompleted);
    }
    if (newFinishers.length > 0) {
      newFinishers.sort(
        (a, b) => (cars[a]?.position ?? Infinity) - (cars[b]?.position ?? Infinity) || a - b,
      );
      for (const i of newFinishers) {
        this.finishRank.set((cars[i] as Car).carIdx, this.finishRank.size + 1);
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
    const order = race ? raceOrder(orderCars) : officialOrder(orderCars);

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

    // The start grid is the live order at the frame the race first goes green, and only when we
    // saw the phase before it (a recording that begins mid-race has no start positions).
    const recordStart =
      race &&
      phase === "racing" &&
      !this.startRecorded &&
      this.prevPhase !== null &&
      !isRacePhase(this.prevPhase);
    if (race && phase === "racing") this.startRecorded = true;
    this.prevPhase = phase;

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
        stintLaps: stintLaps(h, car.lapsCompleted),
        prevStintLaps: h.prevStintLaps,
        startPosition: this.startPositions.get(car.carIdx) ?? null,
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
      return raceGap(
        progress[ahead] as number,
        a.lapDistPct as number,
        progress[behind] as number,
        c.lapDistPct as number,
        ref,
        fallbackLapS,
      );
    };

    // Walk the live order once: ranks, class leaders and the car ahead in the class.
    let leader = -1;
    let rank = 0;
    for (const i of order) {
      const car = cars[i] as Car;
      const ranked = race ? progress[i] !== null : hasOfficialOrder(orderCars[i] as OrderCar);
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
