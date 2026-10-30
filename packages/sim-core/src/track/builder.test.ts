import { describe, expect, it } from "vitest";
import { TrackOutlineBuilder } from "./builder";
import { closedLength, pointAtPct, signedArea } from "./outline";
import { circle, figureEight, lapSamples, type LapOptions } from "./synthetic";
import { OUTLINE_POINTS, type LapResult, type TrackOutline, type TrackSample } from "./types";

const NOW = new Date("2026-10-30T12:00:00Z");

function build(
  samples: TrackSample[],
  trackLengthM: number | null = null,
): { result: LapResult; builder: TrackOutlineBuilder } {
  const builder = new TrackOutlineBuilder({ trackKey: "test_ring", trackLengthM, now: () => NOW });
  for (const s of samples) expect(builder.push(s)).toBeNull();
  return { result: builder.finishNow(), builder };
}

function ok(result: LapResult): TrackOutline {
  if (!result.ok) throw new Error(`lap rejected: ${result.reason} ${result.detail ?? ""}`);
  return result.outline;
}

/** Metres of outline point k, relative to point 0, in east / north (the outline's y is down). */
function relative(outline: TrackOutline, pct: number): { east: number; north: number } {
  const [x0, y0] = pointAtPct(outline, 0);
  const [x, y] = pointAtPct(outline, pct);
  return { east: (x - x0) * outline.scaleM, north: -(y - y0) * outline.scaleM };
}

describe("TrackOutlineBuilder with a circle", () => {
  const radius = 500;
  const length = 2 * Math.PI * radius;

  it("closes the loop, resamples to 1000 points and keeps the length", () => {
    const outline = ok(build(lapSamples(circle(radius)), length).result);
    expect(outline.points).toHaveLength(OUTLINE_POINTS);
    expect(outline.source).toBe("integrated");
    expect(outline.createdAt).toBe(NOW.toISOString());
    expect(outline.lengthM).toBeGreaterThan(length * 0.99);
    expect(outline.lengthM).toBeLessThan(length * 1.01);
    expect(outline.closureErrorM).toBeLessThan(length * 0.005);
    expect(pointAtPct(outline, 0)).toEqual(pointAtPct(outline, 1));
  });

  it("fits the unit box, centred, with a scale in metres", () => {
    const outline = ok(build(lapSamples(circle(radius))).result);
    const xs = outline.points.map((p) => p[0]);
    const ys = outline.points.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 2);
    expect(Math.max(...xs)).toBeCloseTo(1, 2);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(1, 2);
    expect(outline.scaleM).toBeCloseTo(2 * radius, -1);
  });

  it("runs clockwise on a y-down screen, with north up", () => {
    const outline = ok(build(lapSamples(circle(radius))).result);
    expect(signedArea(outline.points)).toBeGreaterThan(0);
    // The lap starts at the north of the circle and heads east: a quarter lap later it is at the
    // east, i.e. right of and below the start.
    const quarter = relative(outline, 0.25);
    expect(quarter.east).toBeCloseTo(radius, -1);
    expect(quarter.north).toBeCloseTo(-radius, -1);
  });

  it("spreads a drifting heading evenly so that the ends meet", () => {
    const biased = build(lapSamples(circle(radius), { headingDriftRad: 0.05 }), length);
    const outline = ok(biased.result);
    // A heading error growing to 2.9 degrees over the lap turns the loop into a spiral that misses by more than ten metres.
    expect(outline.closureErrorM).toBeGreaterThan(10);
    expect(outline.closureErrorM).toBeLessThan(0.02 * length);
    // First and last points of the closed polyline coincide with the first one: the implicit
    // closing segment is no longer than any other.
    const step = closedLength(outline.points) / OUTLINE_POINTS;
    const a = outline.points[OUTLINE_POINTS - 1];
    const b = outline.points[0];
    expect(Math.hypot((a?.[0] ?? 0) - (b?.[0] ?? 0), (a?.[1] ?? 0) - (b?.[1] ?? 0))).toBeLessThan(
      step * 2,
    );
  });

  it("rejects a loop that misses by more than 2% of its length", () => {
    const { result } = build(lapSamples(circle(radius), { headingDriftRad: 0.6 }));
    expect(result).toMatchObject({ ok: false, reason: "closure" });
  });

  it("uses world positions as they are and flips z to the screen's y", () => {
    const outline = ok(build(lapSamples(circle(radius), { source: "world" }), length).result);
    expect(outline.source).toBe("world");
    expect(outline.closureErrorM).toBeLessThan(5);
    expect(outline.lengthM).toBeGreaterThan(length * 0.99);
    expect(signedArea(outline.points)).toBeGreaterThan(0);
    const quarter = relative(outline, 0.25);
    expect(quarter.east).toBeCloseTo(radius, -1);
    expect(quarter.north).toBeCloseTo(-radius, -1);
  });
});

describe("TrackOutlineBuilder with a figure of eight", () => {
  const course = figureEight(400);

  it("builds a closed outline that follows the crossing path", () => {
    const outline = ok(build(lapSamples(course)).result);
    expect(outline.points).toHaveLength(OUTLINE_POINTS);
    expect(pointAtPct(outline, 0)).toEqual(pointAtPct(outline, 1));
    expect(outline.closureErrorM).toBeLessThan(10);
    // Compare with the true course at several fractions of the lap.
    const origin = course(0);
    for (const u of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      const truth = course(u);
      const got = relative(outline, u);
      expect(Math.abs(got.east - (truth.east - origin.east))).toBeLessThan(12);
      expect(Math.abs(got.north - (truth.north - origin.north))).toBeLessThan(12);
    }
  });

  it("gives the same shape from world positions", () => {
    const outline = ok(build(lapSamples(course, { source: "world" })).result);
    const truth = course(0.3);
    const got = relative(outline, 0.3);
    expect(Math.abs(got.east - (truth.east - course(0).east))).toBeLessThan(5);
    expect(Math.abs(got.north - (truth.north - course(0).north))).toBeLessThan(5);
  });
});

describe("TrackOutlineBuilder lap rules", () => {
  const radius = 300;
  const lap = (options: LapOptions = {}): TrackSample[] => lapSamples(circle(radius), options);

  it("ends a lap when lapDistPct wraps and starts the next one", () => {
    const builder = new TrackOutlineBuilder({ trackKey: "k", now: () => NOW });
    const first = lap();
    for (const s of first) builder.push(s);
    const results: LapResult[] = [];
    for (const s of lap({ startTickS: 100.01 })) {
      const result = builder.push(s);
      if (result !== null) results.push(result);
    }
    // The first lap is judged 5 s into the second, when no new best lap has been published.
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(builder.finishNow().ok).toBe(true);
  });

  it("ignores a repeated tick and rejects a clock that goes far back", () => {
    const samples = lap();
    const withDuplicates = samples.flatMap((s, i) => (i % 3 === 0 ? [s, { ...s }] : [s]));
    expect(build(withDuplicates).result.ok).toBe(true);
    const builder = new TrackOutlineBuilder({ trackKey: "k" });
    for (const s of samples.slice(0, 3000)) builder.push(s);
    builder.push({ ...samples[3001]!, tickS: -50 });
    expect(builder.finishNow()).toMatchObject({ ok: false, reason: "incomplete" });
  });

  it("rejects a lap that touches pit road", () => {
    const samples = lap();
    samples[2000] = { ...samples[2000]!, onPitRoad: true };
    expect(build(samples).result).toMatchObject({ ok: false, reason: "pit-road" });
  });

  it("rejects a lap in which the car leaves the world", () => {
    const samples = lap();
    samples[2000] = { ...samples[2000]!, onTrack: false };
    expect(build(samples).result).toMatchObject({ ok: false, reason: "off-track" });
  });

  it("rejects a hole in the ticks: 0.1 s for velocity data, 0.5 s for world positions", () => {
    const hole = (samples: TrackSample[], gapS: number): TrackSample[] =>
      samples.map((s, i) => (i >= 3000 ? { ...s, tickS: s.tickS + gapS } : s));
    expect(build(hole(lap(), 0.2)).result).toMatchObject({ ok: false, reason: "tick-gap" });
    expect(build(hole(lap(), 0.04)).result.ok).toBe(true);
    expect(build(hole(lap({ source: "world" }), 0.3)).result.ok).toBe(true);
    expect(build(hole(lap({ source: "world" }), 0.7)).result).toMatchObject({
      ok: false,
      reason: "tick-gap",
    });
  });

  it("rejects a jump in lapDistPct and a step back of more than 0.05%", () => {
    const jump = lap().filter((_, i) => i < 3000 || i > 3400);
    expect(build(jump).result).toMatchObject({ ok: false, reason: "tick-gap" });
    const back = lap();
    back[3000] = { ...back[3000]!, lapDistPct: (back[3000]?.lapDistPct ?? 0) - 0.05 };
    expect(build(back).result).toMatchObject({ ok: false, reason: "not-monotonic" });
    const roll = lap();
    roll[3000] = { ...roll[3000]!, lapDistPct: (roll[3000]?.lapDistPct ?? 0) - 0.002 };
    expect(build(roll).result).toMatchObject({ ok: false, reason: "not-monotonic" });
    const rounding = lap();
    rounding[3000] = { ...rounding[3000]!, lapDistPct: (rounding[3000]?.lapDistPct ?? 0) - 0.0002 };
    expect(build(rounding).result.ok).toBe(true);
  });

  it("rejects a lap slower than 107% of the best and accepts one inside it", () => {
    expect(build(lap({ lapS: 100, bestLapS: 90 })).result).toMatchObject({
      ok: false,
      reason: "slow-lap",
    });
    expect(build(lap({ lapS: 100, bestLapS: 95 })).result.ok).toBe(true);
  });

  it("reports a lap that started mid-way or stops short as incomplete", () => {
    expect(build(lap({ from: 0.4 })).result).toMatchObject({ ok: false, reason: "incomplete" });
    const short = lap().filter((s) => s.lapDistPct < 0.9);
    expect(build(short).result).toMatchObject({ ok: false, reason: "incomplete" });
    expect(new TrackOutlineBuilder({ trackKey: "k" }).finishNow()).toMatchObject({
      ok: false,
      reason: "incomplete",
    });
  });

  it("rejects an outline whose length is not the track's", () => {
    const { result } = build(lap(), 2 * Math.PI * radius * 1.1);
    expect(result).toMatchObject({ ok: false, reason: "length-mismatch" });
  });

  it("needs a position source and does not mix two", () => {
    const none = lap().map((s) => ({ ...s, headingRad: null }));
    expect(build(none).result).toMatchObject({ ok: false, reason: "no-position" });
    const mixed = lap();
    const world = lap({ source: "world" });
    mixed[500] = world[500]!;
    expect(build(mixed).result).toMatchObject({ ok: false, reason: "mixed-sources" });
  });

  it("lets a world-position lap begin in the pits, leaving the pit lane out", () => {
    const samples = lap({ source: "world", from: 0.0005 });
    const pit = samples.slice(0, 40).map((s) => ({
      ...s,
      onPitRoad: true,
      onTrack: false,
      worldPos: { x: s.worldPos?.x ?? 0, z: (s.worldPos?.z ?? 0) + 30 },
    }));
    const outline = ok(build([...pit, ...samples.slice(40)]).result);
    expect(outline.lengthM).toBeGreaterThan(2 * Math.PI * radius * 0.99);
    // But not a velocity-integrated one, whose path would have a hole.
    const integrated = lap().map((s, i) => (i < 40 ? { ...s, onPitRoad: true } : s));
    expect(build(integrated).result).toMatchObject({ ok: false, reason: "pit-road" });
    // And a pit stop in the middle is never allowed.
    const stop = lap({ source: "world" });
    stop[3000] = { ...stop[3000]!, onPitRoad: true };
    expect(build(stop).result).toMatchObject({ ok: false, reason: "pit-road" });
  });

  it("rejects reverse motion, a long standstill and a new incident", () => {
    const reverse = lap();
    reverse[3000] = { ...reverse[3000]!, velocityMps: { x: -2, y: 0 } };
    expect(build(reverse).result).toMatchObject({ ok: false, reason: "reversing" });
    // 4 s at walking pace: samples are 1/60 s apart, so 240 of them.
    const slow = lap().map((s, i) =>
      i >= 3000 && i < 3300 ? { ...s, velocityMps: { x: 0.1, y: 0 } } : s,
    );
    expect(build(slow).result).toMatchObject({ ok: false, reason: "standstill" });
    const brief = lap().map((s, i) =>
      i >= 3000 && i < 3100 ? { ...s, velocityMps: { x: 0.1, y: 0 } } : s,
    );
    expect(build(brief).result.ok).toBe(true);
    const incident = lap().map((s, i) => ({ ...s, incidentCount: i < 4000 ? 2 : 4 }));
    expect(build(incident).result).toMatchObject({ ok: false, reason: "incident" });
    const steady = lap().map((s) => ({ ...s, incidentCount: 4 }));
    expect(build(steady).result.ok).toBe(true);
  });

  it("reports a pit-exit world lap's coverage and bridge, and a vector closure error", () => {
    const full = ok(build(lap({ source: "world" })).result);
    expect(full.gapPct).toBeLessThan(0.002);
    const exit = ok(build(lap({ source: "world", from: 0.03 })).result);
    expect(exit.gapPct).toBeGreaterThan(0.03);
    expect(exit.bridgeM).toBeGreaterThan(0.03 * 2 * Math.PI * radius * 0.9);
    // The bridge is where a car heading on would be only if it were straight; a circle's is a chord.
    expect(exit.closureErrorM).toBeGreaterThan(0.1);
    expect(exit.closureErrorM).toBeLessThan(exit.bridgeM);
  });
});
