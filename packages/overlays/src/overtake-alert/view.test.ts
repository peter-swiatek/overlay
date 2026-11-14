import type { Car, DerivedGap, TelemetryFrame } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import {
  classPaceS,
  gapProgress,
  gapText,
  overtakeView,
  rowTops,
  sampleOvertakeRows,
  type OvertakeOptions,
} from "./view";

const GT3 = { classId: "1", className: "GT3", classColour: "#ffda59" };
const HYPER = { classId: "2", className: "Hypercar", classColour: "#ff5888" };
const LMP2 = { classId: "3", className: "LMP2", classColour: "#33ceff" };

const OPTIONS: OvertakeOptions = {
  windowS: 5,
  maxRows: 2,
  includeSameClass: false,
  livePositions: true,
  gapDecimals: 1,
  lapDecimals: 3,
};

type CarIn = Partial<Car> & { carIdx: number; gap?: number | null };

/**
 * Player carIdx 0 in GT3 (best lap 100 s); Hypercars best 86 s. Each other car's `gap` is its
 * derived relative gap (positive = behind).
 */
function frame(
  cars: CarIn[],
  extra: { classBest?: Record<string, number>; player?: Partial<Car> } = {},
): TelemetryFrame {
  const all: CarIn[] = [
    { carIdx: 0, ...GT3, bestLapS: 100, driverName: "Max Example", ...extra.player },
    ...cars,
  ];
  const gaps: DerivedGap[] = cars.map((c) => ({
    carIdx: c.carIdx,
    gapS: c.gap ?? null,
    tier: "position",
  }));
  return fixtureFrame({
    cars: all.map((c) => {
      const car = { ...c };
      delete car.gap;
      return car;
    }),
    playerCarIdx: 0,
    gaps,
    standings: all.map((c) => ({ carIdx: c.carIdx })),
    standingsInfo: { classBestLapS: extra.classBest ?? { "1": 100, "2": 86 } },
    session: { type: "race" },
  });
}

const hyper = (carIdx: number, gap: number | null, more: Partial<Car> = {}): CarIn => ({
  carIdx,
  ...HYPER,
  carNumber: String(carIdx + 1),
  driverName: `Driver ${carIdx}`,
  gap,
  ...more,
});
const gt3 = (carIdx: number, gap: number | null): CarIn => ({ carIdx, ...GT3, gap });

const ids = (f: TelemetryFrame, options: Partial<OvertakeOptions> = {}): number[] =>
  overtakeView(f, { ...OPTIONS, ...options }).map((r) => r.carIdx);

describe("overtakeView", () => {
  it("shows faster-class cars behind within the window, closest first, up to max rows", () => {
    const f = frame([hyper(1, 3.8), hyper(2, 1.2), hyper(3, 4.4), hyper(4, 6), hyper(5, -1)]);
    expect(ids(f)).toEqual([2, 1]);
    expect(ids(f, { maxRows: 3 })).toEqual([2, 1, 3]);
    expect(ids(f, { maxRows: 4, windowS: 10 })).toEqual([2, 1, 3, 4]);
    const rows = overtakeView(f, OPTIONS);
    expect(rows.map((r) => r.gapText)).toEqual(["+1.2s", "+3.8s"]);
    expect(rows[0]?.progress).toBeCloseTo(0.76);
    expect(rows[1]?.progress).toBeCloseTo(0.24);
    expect(rows[0]).toMatchObject({
      carNumber: "3",
      classColour: "#ff5888",
      driverName: "Driver 2",
    });
  });

  it("leaves out cars ahead, at no gap, unknown gaps and a gap just past the window", () => {
    const f = frame([hyper(1, -0.5), hyper(2, 0), hyper(3, null), hyper(4, 5), hyper(5, 5.01)]);
    expect(ids(f)).toEqual([4]);
  });

  it("leaves out cars in the pits, in their stall and disconnected", () => {
    const f = frame([
      hyper(1, 1, { onPitRoad: true }),
      hyper(2, 2, { inPitStall: true }),
      hyper(3, 3, { connected: false }),
      hyper(4, 4),
    ]);
    expect(ids(f)).toEqual([4]);
  });

  it("shows only faster classes: not the player's class or a slower one, unless asked", () => {
    const f = frame([gt3(1, 1), { carIdx: 2, ...LMP2, gap: 2 }, hyper(3, 3)], {
      classBest: { "1": 100, "2": 86, "3": 104 },
    });
    expect(ids(f)).toEqual([3]);
    expect(ids(f, { includeSameClass: true })).toEqual([1, 3]);
  });

  it("ranks classes by their best lap, else their cars' best laps; a class with no lap is not faster", () => {
    const f = frame([hyper(1, 1, { bestLapS: 87 }), { carIdx: 2, ...LMP2, gap: 2 }], {
      classBest: {},
    });
    expect(classPaceS(f, "2")).toBe(87);
    expect(classPaceS(f, "1")).toBe(100);
    expect(classPaceS(f, "3")).toBeNull();
    expect(ids(f)).toEqual([1]);
    const noPlayerPace = frame([hyper(1, 1)], { classBest: {}, player: { bestLapS: null } });
    expect(ids(noPlayerPace)).toEqual([]);
  });

  it("shows nothing in a single-class session, even with my class included", () => {
    const f = frame([gt3(1, 1), gt3(2, 2)]);
    expect(ids(f)).toEqual([]);
    expect(ids(f, { includeSameClass: true })).toEqual([]);
  });

  it("shows nothing without a live frame, without a player or while the player is in the pits", () => {
    expect(overtakeView(null, OPTIONS)).toEqual([]);
    const f = frame([hyper(1, 1)]);
    expect(overtakeView({ ...f, status: "waiting" }, OPTIONS)).toEqual([]);
    expect(overtakeView({ ...f, state: { ...f.state, playerCarIdx: null } }, OPTIONS)).toEqual([]);
    expect(ids(frame([hyper(1, 1)], { player: { onPitRoad: true } }))).toEqual([]);
  });

  it("clamps the window to its setting range", () => {
    const f = frame([hyper(1, 1.5), hyper(2, 9.5), hyper(3, 10.5)]);
    expect(ids(f, { windowS: 0.5, maxRows: 4 })).toEqual([1]);
    expect(ids(f, { windowS: 30, maxRows: 4 })).toEqual([1, 2]);
  });

  it("keeps unchanged rows' identity", () => {
    const f = frame([hyper(1, 2.5)]);
    const first = overtakeView(f, OPTIONS);
    expect(overtakeView(f, OPTIONS, first)[0]).toBe(first[0]);
  });
});

describe("gap text and progress", () => {
  it("shows one decimal with a plus and an s", () => {
    expect(gapText(1.24)).toBe("+1.2s");
    expect(gapText(3.75)).toBe("+3.8s");
  });

  it("runs from 0 at the window limit to 1 at no gap, clamped", () => {
    expect(gapProgress(5, 5)).toBe(0);
    expect(gapProgress(0, 5)).toBe(1);
    expect(gapProgress(2.5, 5)).toBe(0.5);
    expect(gapProgress(7, 5)).toBe(0);
    expect(gapProgress(-1, 5)).toBe(1);
    expect(gapProgress(1, 0)).toBe(0);
  });
});

describe("rowTops", () => {
  /** Evaluates a rowTops expression for a window `h` rows high, in rows. */
  function rowsFromTop(expr: string, h: number): number {
    const js = expr
      .replace(/100cqh/g, String(h))
      .replace(/calc\(/g, "(")
      .replace(/min\(/g, "Math.min(")
      .replace(/max\(/g, "Math.max(")
      .replace(/R/g, "1");
    return Number(new Function(`return ${js};`)());
  }
  const at = (progress: number[], h: number): number[] =>
    rowTops(progress, "R").map((e) => Math.round(rowsFromTop(e, h) * 1000) / 1000);

  it("puts one row at the top at no gap and at the bottom at the window limit", () => {
    expect(at([1], 4)).toEqual([0]);
    expect(at([0], 4)).toEqual([3]);
    expect(at([0.5], 4)).toEqual([1.5]);
  });

  it("places rows by their own progress while they are apart", () => {
    expect(at([0.76, 0.24], 4)).toEqual([0.72, 2.28]);
  });

  it("pushes a closing row below the one above, and keeps room for the rows below", () => {
    // Nearly the same gap: the second row sits right under the first.
    expect(at([0.5, 0.48], 4)).toEqual([1.5, 2.5]);
    // Both at the far end: the first rises to leave room for the second.
    expect(at([0, 0], 4)).toEqual([2, 3]);
    expect(at([1, 1, 1], 4)).toEqual([0, 1, 2]);
  });

  it("writes CSS with the window height and the row height", () => {
    expect(rowTops([0.5], "var(--ov-row-height, 24px)")).toEqual([
      "min(calc(100cqh - 1 * var(--ov-row-height, 24px)), calc((100cqh - var(--ov-row-height, 24px)) * 0.5))",
    ]);
  });
});

describe("sampleOvertakeRows", () => {
  it("is the design's two Hypercars, 1.2 s and 3.8 s behind", () => {
    const rows = sampleOvertakeRows();
    expect(rows.map((r) => [r.position, r.carNumber, r.driverName, r.licence, r.iRating])).toEqual([
      [2, "10", "Nadia Quill", "A 3.00", 2500],
      [3, "15", "Kasper Holm", "A 3.00", 2700],
    ]);
    expect(rows.map((r) => r.gapText)).toEqual(["+1.2s", "+3.8s"]);
    expect(rows[0]?.progress).toBeCloseTo(0.76);
    expect(sampleOvertakeRows(10)[1]?.progress).toBeCloseTo(0.62);
  });
});
