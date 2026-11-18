import type { Car, SimState, Standings, StandingsEntry } from "@overlay/sim-core/types";
import { formatDriverName } from "@overlay/ui/format";

export interface HeadToHeadCar {
  classPosition: number;
  classColour: string | null;
  carNumber: string | null;
  name: string;
  /** Gap at the timing line: "-1.2" ahead / "+0.9" behind, "1L" in laps, "--" unknown. */
  gapText: string;
  /** Their last lap minus yours; positive = you were faster (gain). */
  lastLapDiffS: number | null;
}

export interface HeadToHead {
  ahead: HeadToHeadCar | null;
  behind: HeadToHeadCar | null;
}

/** "<n>L" for whole laps, else seconds with one decimal and a sign; "--" when unknown. */
export function gapText(
  gap: { laps: number; seconds: number | null } | null,
  sign: "-" | "+",
): string {
  if (gap === null) return "--";
  if (gap.laps >= 1) return `${gap.laps}L`;
  if (gap.seconds === null || !Number.isFinite(gap.seconds) || gap.seconds <= 0) return "--";
  return `${sign}${gap.seconds.toFixed(1)}`;
}

const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

/**
 * The cars one place ahead and behind the player in the player's class (live class position, or
 * the official one when `livePositions` is false). Races only, from lap 2. Null when there is
 * nothing to show.
 */
export function headToHead(
  state: SimState,
  standings: Standings | null,
  lapNumber: number | null,
  livePositions: boolean,
): HeadToHead | null {
  if (standings === null || state.session.type !== "race") return null;
  if (lapNumber === null || lapNumber < 2) return null;
  if (state.playerCarIdx === null) return null;

  const carOf = new Map<number, Car>();
  for (const c of state.cars) carOf.set(c.carIdx, c);
  const me = standings.entries.find((e) => e.carIdx === state.playerCarIdx);
  const meCar = carOf.get(state.playerCarIdx);
  if (me === undefined || meCar === undefined) return null;
  const pos = (e: StandingsEntry): number | null =>
    finite(livePositions ? e.liveClassPosition : e.classPosition);
  const myPos = pos(me);
  if (myPos === null) return null;
  const classId = meCar.classId ?? "";
  const mine = finite(state.player.lap?.lastLapS) ?? finite(meCar.lastLapS);

  const find = (target: number): { entry: StandingsEntry; car: Car } | null => {
    for (const entry of standings.entries) {
      if (pos(entry) !== target) continue;
      const car = carOf.get(entry.carIdx);
      if (car === undefined || (car.classId ?? "") !== classId) continue;
      return { entry, car };
    }
    return null;
  };
  const build = (
    hit: { entry: StandingsEntry; car: Car } | null,
    target: number,
    text: string,
  ): HeadToHeadCar | null => {
    if (hit === null) return null;
    const theirs = finite(hit.car.lastLapS);
    return {
      classPosition: target,
      classColour: hit.car.classColour,
      carNumber: hit.car.carNumber,
      name: formatDriverName(hit.car.driverName, "f-last"),
      gapText: text,
      lastLapDiffS: theirs === null || mine === null ? null : theirs - mine,
    };
  };

  const ahead = find(myPos - 1);
  const behind = find(myPos + 1);
  const result: HeadToHead = {
    // Gaps as they stood at the timing line (yours to the car ahead when you last crossed it, the
    // car behind's to you when it last did), so the tiles change once a lap, not continuously.
    ahead: build(ahead, myPos - 1, gapText(me.lineInterval ?? null, "-")),
    behind: build(behind, myPos + 1, gapText(behind?.entry.lineInterval ?? null, "+")),
  };
  return result.ahead === null && result.behind === null ? null : result;
}
