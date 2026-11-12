import type { TelemetryFrame } from "@overlay/sim-core/types";
import { carLabel } from "../track-map/view";

/** One car on the bar. */
export interface FlatCar {
  carIdx: number;
  /** Lap-distance fraction 0..1. */
  pct: number;
  /** Car number without any "#"; null when unknown. */
  number: string | null;
  /** Class colour as given by the sim; null when unknown. */
  colour: string | null;
  /** In the pit lane or stall: drawn dimmed. */
  pit: boolean;
  /** Off track, or the slow car the deriver reports: drawn in flag yellow. */
  flag: boolean;
  player: boolean;
}

export interface FlatLive {
  sectorStartPcts: readonly number[] | null;
  cars: FlatCar[];
}

const NO_LIVE: FlatLive = { sectorStartPcts: null, cars: [] };

/** Telemetry selector: the sector boundaries and every car that is in the world. */
export function flatLive(frame: TelemetryFrame | null): FlatLive {
  if (frame === null || frame.status !== "live") return NO_LIVE;
  const { state, derived } = frame;
  const slowIdx = derived.slowCar?.carIdx ?? null;
  const cars: FlatCar[] = [];
  for (const car of state.cars) {
    if (car.isPaceCar === true || car.lapDistPct === null || !Number.isFinite(car.lapDistPct)) {
      continue;
    }
    if (car.isOnTrack === false || car.trackSurface === "notInWorld") continue;
    const pit = car.onPitRoad === true || car.trackSurface === "inPitStall";
    cars.push({
      carIdx: car.carIdx,
      // 0.0001 of a lap is well under a pixel on the bar.
      pct: Math.round((((car.lapDistPct % 1) + 1) % 1) * 10000) / 10000,
      number: carLabel(car.carNumber),
      colour: car.classColour,
      pit,
      flag: !pit && (car.trackSurface === "offTrack" || car.carIdx === slowIdx),
      player: car.carIdx === state.playerCarIdx,
    });
  }
  return { sectorStartPcts: state.session.sectorStartPcts, cars };
}

/** Draw order: pit cars at the back, then the field, flagged cars, and the player on top. */
export function orderCars(cars: readonly FlatCar[]): FlatCar[] {
  const rank = (c: FlatCar): number => (c.player ? 3 : c.flag ? 2 : c.pit ? 0 : 1);
  return cars
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

/**
 * The sector starts as sorted, distinct fractions inside (0, 1): the inner boundaries where a
 * grey tick goes. Start/finish (0) is drawn separately.
 */
export function innerBoundaries(sectorStartPcts: readonly number[] | null): number[] {
  const out: number[] = [];
  for (const raw of sectorStartPcts ?? []) {
    if (!Number.isFinite(raw)) continue;
    const p = ((raw % 1) + 1) % 1;
    if (p < 1e-6 || p > 1 - 1e-6) continue;
    if (out.some((q) => Math.abs(q - p) < 1e-6)) continue;
    out.push(p);
  }
  return out.sort((a, b) => a - b);
}

export type LabelAnchor = "start" | "middle" | "end";

export interface BarLabel {
  kind: "start" | "sector" | "player";
  text: string;
  /** Where the label's anchor sits on the bar, 0..1. */
  pct: number;
  anchor: LabelAnchor;
}

/**
 * "S/F" at the left end, then each sector's name where that sector ends: "S1" at the first inner
 * boundary, and the last sector's name at the right end of the bar. Without boundaries there are
 * no sectors to name and only "S/F" shows.
 */
export function sectorLabels(sectorStartPcts: readonly number[] | null): BarLabel[] {
  const inner = innerBoundaries(sectorStartPcts);
  const labels: BarLabel[] = [{ kind: "start", text: "S/F", pct: 0, anchor: "start" }];
  if (inner.length === 0) return labels;
  inner.forEach((pct, i) => {
    labels.push({ kind: "sector", text: `S${i + 1}`, pct, anchor: "middle" });
  });
  labels.push({ kind: "sector", text: `S${inner.length + 1}`, pct: 1, anchor: "end" });
  return labels;
}

/** "1 YOU (46%)"; "YOU (46%)" without a car number. The lap share is floored, never 100 %. */
export function playerText(car: Pick<FlatCar, "number" | "pct">): string {
  const share = Math.min(99, Math.max(0, Math.floor(car.pct * 100)));
  return `${car.number === null ? "YOU" : `${car.number} YOU`} (${share}%)`;
}

/** Label font size relative to the panel's, as in the CSS. */
export const LABEL_SCALE = 0.72;
/** Rough advance of one character of label text, in label ems (bold, tabular figures). */
const CHAR_EM = 0.62;
/** Space kept between two labels, in panel ems. */
const LABEL_GAP_EM = 0.5;
/** The bar's width in panel ems at the default 480 px window and 14 px text (1 em each side). */
export const DEFAULT_BAR_EM = (480 - 28) / 14;

/** Estimated width of a label in panel ems. */
export function labelWidthEm(text: string): number {
  return text.length * CHAR_EM * LABEL_SCALE;
}

/** The label's left and right edge on the bar, in panel ems. */
function span(label: BarLabel, barEm: number): [number, number] {
  const w = labelWidthEm(label.text);
  const x = label.pct * barEm;
  if (label.anchor === "start") return [x, x + w];
  if (label.anchor === "end") return [x - w, x];
  return [x - w / 2, x + w / 2];
}

const overlaps = (a: [number, number], b: [number, number]): boolean =>
  a[0] < b[1] + LABEL_GAP_EM && b[0] < a[1] + LABEL_GAP_EM;

/** The player label centred under the player; anchored to an end of the bar when it would spill. */
export function playerLabel(car: Pick<FlatCar, "number" | "pct">, barEm: number): BarLabel {
  const text = playerText(car);
  const half = labelWidthEm(text) / 2;
  const x = car.pct * barEm;
  if (x - half < 0) return { kind: "player", text, pct: 0, anchor: "start" };
  if (x + half > barEm) return { kind: "player", text, pct: 1, anchor: "end" };
  return { kind: "player", text, pct: car.pct, anchor: "middle" };
}

/**
 * The labels under the bar. The player label wins: any sector label it would overlap is hidden,
 * and a sector label that would overlap one already kept (very short sectors) is hidden too.
 */
export function barLabels(
  sectors: readonly BarLabel[],
  player: BarLabel | null,
  barEm: number,
): BarLabel[] {
  const kept: BarLabel[] = player === null ? [] : [player];
  const spans = kept.map((l) => span(l, barEm));
  for (const label of sectors) {
    const s = span(label, barEm);
    if (spans.some((t) => overlaps(s, t))) continue;
    kept.push(label);
    spans.push(s);
  }
  return kept;
}

/** Edit-mode sample: the board's field, two classes, one car in the pits and one slow car. */
export const SAMPLE_SECTOR_STARTS: readonly number[] = [0, 0.33, 0.68];
export const SAMPLE_CARS: readonly FlatCar[] = [
  { carIdx: 1, pct: 0.19, number: "7", colour: "#ffda59", pit: false, flag: false, player: false },
  { carIdx: 2, pct: 0.3, number: "22", colour: "#ff5c8a", pit: false, flag: false, player: false },
  { carIdx: 3, pct: 0.39, number: "48", colour: "#ff5c8a", pit: false, flag: false, player: false },
  { carIdx: 4, pct: 0.43, number: "15", colour: "#ffda59", pit: false, flag: false, player: false },
  { carIdx: 5, pct: 0.52, number: "3", colour: "#33ceff", pit: false, flag: true, player: false },
  { carIdx: 6, pct: 0.57, number: "91", colour: "#ffda59", pit: false, flag: false, player: false },
  { carIdx: 7, pct: 0.82, number: "64", colour: "#ff5c8a", pit: false, flag: false, player: false },
  { carIdx: 8, pct: 0.9, number: "12", colour: "#33ceff", pit: true, flag: false, player: false },
  { carIdx: 0, pct: 0.46, number: "1", colour: "#ffda59", pit: false, flag: false, player: true },
];
