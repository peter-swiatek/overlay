import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState } from "../../model";
import type { Car, CarLeftRight, SimState, Vec3 } from "../../model";
import { CAR_LENGTH_M, LMU_RIGHT_SIGN, ProximityTracker } from "./index";

const TRACK_M = 5000;

function car(idx: number, patch: Partial<Car> = {}): Car {
  return {
    ...emptyCar(idx),
    connected: true,
    isOnTrack: true,
    onPitRoad: false,
    isPaceCar: false,
    lapDistPct: 0.5,
    ...patch,
  };
}

function iracing(
  call: CarLeftRight | null,
  cars: Car[],
  patch: { tick?: number; trackLengthM?: number | null } = {},
): SimState {
  const s = emptySimState();
  s.connected = true;
  s.sim = "iracing";
  s.tickTimeS = patch.tick ?? 100;
  s.playerCarIdx = 0;
  s.session.trackLengthM = patch.trackLengthM === undefined ? TRACK_M : patch.trackLengthM;
  s.player.carLeftRight = call;
  s.cars = cars;
  return s;
}

/** Metres to a lap-distance fraction. */
const m = (metres: number): number => metres / TRACK_M;

describe("iRacing proximity", () => {
  const player = car(0, { lapDistPct: 0.5 });

  it("returns null without a usable player", () => {
    const t = new ProximityTracker();
    const s = iracing("clear", [car(1)]);
    s.playerCarIdx = null;
    expect(t.next(s)).toBeNull();
    expect(t.next(iracing("clear", [car(1)]))).toBeNull(); // no player car in the list
    expect(t.next(iracing("clear", [car(0, { lapDistPct: null })]))).toBeNull();
    expect(t.next(iracing("clear", [car(0, { isOnTrack: false })]))).toBeNull();
    const off = iracing("clear", [player]);
    off.connected = false;
    expect(t.next(off)).toBeNull();
  });

  it("clear gives empty bars but still lists nearby cars nearest first", () => {
    const t = new ProximityTracker();
    const r = t.next(
      iracing("clear", [
        player,
        car(1, { lapDistPct: 0.5 + m(15) }),
        car(2, { lapDistPct: 0.5 - m(3) }),
        car(3, { lapDistPct: 0.5 + m(30) }),
      ]),
    );
    expect(r?.left).toBeNull();
    expect(r?.right).toBeNull();
    expect(r?.carLengthM).toBe(CAR_LENGTH_M);
    expect(r?.nearby.map((c) => c.carIdx)).toEqual([2, 1]);
    expect(r?.nearby[0]?.longitudinalM).toBeCloseTo(-3, 6);
    expect(r?.nearby[0]?.lateralM).toBeNull();
  });

  it("left and right use the nearest candidate's offset in car lengths", () => {
    const t = new ProximityTracker();
    const cars = [player, car(1, { lapDistPct: 0.5 + m(2.4) }), car(2, { lapDistPct: 0.5 - m(5) })];
    const l = t.next(iracing("left", cars));
    expect(l?.left).toBeCloseTo(0.5, 6);
    expect(l?.right).toBeNull();
    expect(l?.nearby[0]?.side).toBe("left");
    const r = t.next(iracing("right", cars));
    expect(r?.right).toBeCloseTo(0.5, 6);
    expect(r?.left).toBeNull();
  });

  it("clamps the offset to one car length", () => {
    const t = new ProximityTracker();
    const r = t.next(iracing("left", [player, car(1, { lapDistPct: 0.5 - m(6.5) })]));
    expect(r?.left).toBe(-1);
  });

  it("twoLeft and twoRight fill one side only", () => {
    const t = new ProximityTracker();
    const cars = [player, car(1, { lapDistPct: 0.5 + m(1) })];
    expect(t.next(iracing("twoLeft", cars))).toMatchObject({ right: null });
    expect(t.next(iracing("twoLeft", cars))?.left).toBeCloseTo(1 / CAR_LENGTH_M, 6);
    const r = t.next(iracing("twoRight", cars));
    expect(r?.left).toBeNull();
    expect(r?.right).toBeCloseTo(1 / CAR_LENGTH_M, 6);
  });

  it("wraps across the start/finish line", () => {
    const t = new ProximityTracker();
    const p = car(0, { lapDistPct: 0.9995 });
    const r = t.next(iracing("right", [p, car(1, { lapDistPct: 0.0005 })]));
    expect(r?.nearby[0]?.longitudinalM).toBeCloseTo(5, 6);
    expect(r?.right).toBe(1);
  });

  it("without a track length only the sim call is reported", () => {
    const t = new ProximityTracker();
    const r = t.next(
      iracing("both", [player, car(1, { lapDistPct: 0.5 })], { trackLengthM: null }),
    );
    expect(r).toEqual({
      carLeftRight: "both",
      left: null,
      right: null,
      nearby: [],
      carLengthM: CAR_LENGTH_M,
    });
  });

  it("shows level (0) when the call has no car in range", () => {
    const t = new ProximityTracker();
    const far = [player, car(1, { lapDistPct: 0.5 + m(100) })];
    expect(t.next(iracing("left", far))).toMatchObject({ left: 0, right: null });
    expect(t.next(iracing("twoRight", far))).toMatchObject({ left: null, right: 0 });
    expect(t.next(iracing("both", far))).toMatchObject({ left: 0, right: 0 });
  });

  it("both with one candidate lights both bars from it", () => {
    const t = new ProximityTracker();
    const r = t.next(iracing("both", [player, car(1, { lapDistPct: 0.5 - m(2.4) })]));
    expect(r?.left).toBeCloseTo(-0.5, 6);
    expect(r?.right).toBeCloseTo(-0.5, 6);
  });

  it("both without memory assigns the lower carIdx to the left", () => {
    const t = new ProximityTracker();
    const r = t.next(
      iracing("both", [
        player,
        car(7, { lapDistPct: 0.5 + m(1) }),
        car(3, { lapDistPct: 0.5 - m(2) }),
      ]),
    );
    expect(r?.left).toBeCloseTo(-2 / CAR_LENGTH_M, 6);
    expect(r?.right).toBeCloseTo(1 / CAR_LENGTH_M, 6);
  });

  it("both uses the side a one-sided call gave each car", () => {
    const t = new ProximityTracker();
    // Car 7 was seen on the right first, then car 3 joins on the left: the cars keep their sides.
    t.next(iracing("right", [player, car(7, { lapDistPct: 0.5 + m(1) })], { tick: 100 }));
    const r = t.next(
      iracing(
        "both",
        [player, car(7, { lapDistPct: 0.5 + m(1) }), car(3, { lapDistPct: 0.5 - m(2) })],
        { tick: 101 },
      ),
    );
    expect(r?.right).toBeCloseTo(1 / CAR_LENGTH_M, 6);
    expect(r?.left).toBeCloseTo(-2 / CAR_LENGTH_M, 6);
    // Car 3 on the left of the same pair via memory of car 3 alone.
    const t2 = new ProximityTracker();
    t2.next(iracing("left", [player, car(7, { lapDistPct: 0.5 + m(1) })], { tick: 100 }));
    const r2 = t2.next(
      iracing(
        "both",
        [player, car(7, { lapDistPct: 0.5 + m(1) }), car(3, { lapDistPct: 0.5 - m(2) })],
        { tick: 101 },
      ),
    );
    expect(r2?.left).toBeCloseTo(1 / CAR_LENGTH_M, 6);
    expect(r2?.right).toBeCloseTo(-2 / CAR_LENGTH_M, 6);
  });

  it("forgets a side after 5 s unseen and on reset", () => {
    const side = (t: ProximityTracker, tick: number) =>
      t.next(
        iracing(
          "both",
          [player, car(7, { lapDistPct: 0.5 + m(1) }), car(3, { lapDistPct: 0.5 - m(2) })],
          { tick },
        ),
      );
    const t = new ProximityTracker();
    t.next(iracing("right", [player, car(7, { lapDistPct: 0.5 + m(1) })], { tick: 100 }));
    // Car 7 leaves for 6 s, then returns alongside car 3.
    t.next(iracing("clear", [player], { tick: 103 }));
    t.next(iracing("clear", [player], { tick: 106.5 }));
    expect(side(t, 107)?.left).toBeCloseTo(-2 / CAR_LENGTH_M, 6); // memory gone: lower carIdx (3) left
    expect(side(t, 107)?.right).toBeCloseTo(1 / CAR_LENGTH_M, 6);

    const t2 = new ProximityTracker();
    t2.next(iracing("left", [player, car(7, { lapDistPct: 0.5 + m(1) })], { tick: 100 }));
    t2.reset();
    expect(side(t2, 101)?.left).toBeCloseTo(-2 / CAR_LENGTH_M, 6);
  });

  it("filters by pit road and ignores pace cars and cars out of the world", () => {
    const t = new ProximityTracker();
    const near = 0.5 + m(2);
    const cars = [
      player,
      car(1, { lapDistPct: near, onPitRoad: true }),
      car(2, { lapDistPct: near, isPaceCar: true }),
      car(3, { lapDistPct: near, isOnTrack: false }),
      car(4, { lapDistPct: near, connected: false }),
    ];
    expect(t.next(iracing("clear", cars))?.nearby).toEqual([]);
    const pitting = [
      { ...player, onPitRoad: true },
      ...cars.slice(1),
      car(5, { lapDistPct: near, onPitRoad: true }),
    ];
    expect(t.next(iracing("clear", pitting))?.nearby.map((c) => c.carIdx)).toEqual([1, 5]);
  });
});

// ---- LMU ----------------------------------------------------------------------------------

function lmu(
  pos: Vec3,
  others: { idx: number; x: number; z: number }[],
  patch: { yaw?: number | null; tick?: number } = {},
): SimState {
  const s = emptySimState();
  s.connected = true;
  s.sim = "lmu";
  s.tickTimeS = patch.tick ?? 10;
  s.playerCarIdx = 0;
  s.session.trackLengthM = TRACK_M;
  s.player.worldPos = pos;
  s.player.yawRad = patch.yaw ?? null;
  s.cars = [car(0), ...others.map((o) => car(o.idx, { worldPos: { x: o.x, y: 0, z: o.z } }))];
  return s;
}

/**
 * A ground heading as a unit vector, and the point `fwd` ahead and `right` to the right of the
 * player, using the rule documented at LMU_RIGHT_SIGN (right = (fz, -fx)).
 */
function place(
  origin: Vec3,
  headingDeg: number,
  fwd: number,
  right: number,
): { x: number; z: number } {
  const a = (headingDeg * Math.PI) / 180;
  const fx = Math.sin(a);
  const fz = -Math.cos(a);
  const rx = LMU_RIGHT_SIGN * fz;
  const rz = -LMU_RIGHT_SIGN * fx;
  return { x: origin.x + fx * fwd + rx * right, z: origin.z + fz * fwd + rz * right };
}

describe("LMU proximity", () => {
  const origin: Vec3 = { x: 100, y: 5, z: -40 };

  it.each([0, 90, 180, 270, 37])("places cars in the player frame at heading %i degrees", (deg) => {
    const yaw = (deg * Math.PI) / 180;
    const at = (fwd: number, right: number, idx = 1) => ({
      idx,
      ...place(origin, deg, fwd, right),
    });
    const t = new ProximityTracker();
    const leftCar = t.next(lmu(origin, [at(0, -3)], { yaw }));
    expect(leftCar?.carLeftRight).toBe("left");
    expect(leftCar?.left).toBeCloseTo(0, 6);
    expect(leftCar?.right).toBeNull();
    expect(leftCar?.nearby[0]?.lateralM).toBeCloseTo(-3, 6);

    const rightCar = t.next(lmu(origin, [at(2.4, 3)], { yaw }));
    expect(rightCar?.carLeftRight).toBe("right");
    expect(rightCar?.right).toBeCloseTo(0.5, 6);

    const ahead = t.next(lmu(origin, [at(10, 0)], { yaw }));
    expect(ahead?.carLeftRight).toBe("clear");
    expect(ahead?.nearby[0]?.longitudinalM).toBeCloseTo(10, 6);
    expect(ahead?.nearby[0]?.side).toBeNull();

    const behind = t.next(lmu(origin, [at(-10, 0.2)], { yaw }));
    expect(behind?.nearby[0]?.longitudinalM).toBeCloseTo(-10, 6);
    expect(behind?.nearby[0]?.lateralM).toBeCloseTo(0.2, 6);
  });

  it("derives both, twoLeft and twoRight from the sides", () => {
    const t = new ProximityTracker();
    const at = (fwd: number, right: number, idx: number) => ({
      idx,
      ...place(origin, 0, fwd, right),
    });
    expect(t.next(lmu(origin, [at(0, -3, 1), at(1, 3, 2)], { yaw: 0 }))?.carLeftRight).toBe("both");
    const two = t.next(lmu(origin, [at(3, -3, 1), at(-1, -3.5, 2)], { yaw: 0 }));
    expect(two?.carLeftRight).toBe("twoLeft");
    expect(two?.left).toBeCloseTo(-1 / CAR_LENGTH_M, 6); // nearest of the two
    expect(t.next(lmu(origin, [at(0, 3, 1), at(1, 3.5, 2)], { yaw: 0 }))?.carLeftRight).toBe(
      "twoRight",
    );
  });

  it("does not count a car 6 m to the side, one too close, or one too far ahead", () => {
    const t = new ProximityTracker();
    const at = (fwd: number, right: number, idx: number) => ({
      idx,
      ...place(origin, 0, fwd, right),
    });
    const r = t.next(lmu(origin, [at(0, 6, 1), at(0, 0.5, 2), at(8, 3, 3)], { yaw: 0 }));
    expect(r?.carLeftRight).toBe("clear");
    expect(r?.nearby).toHaveLength(3);
  });

  it("takes the heading from motion once the car has moved 0.5 m", () => {
    const t = new ProximityTracker();
    const start: Vec3 = { x: 0, y: 0, z: 0 };
    const other = { idx: 1, x: 3, z: -10 };
    expect(t.next(lmu(start, [other], { tick: 1 }))).toBeNull(); // first frame: no heading
    expect(t.next(lmu({ x: 0, y: 0, z: -0.2 }, [other], { tick: 1.1 }))).toBeNull(); // under 0.5 m
    // Driving towards -z (yaw 0): a car at +x is on the left.
    const r = t.next(lmu({ x: 0, y: 0, z: -1 }, [other], { tick: 1.2 }));
    expect(r?.nearby[0]?.lateralM).toBeCloseTo(-3, 6);
    expect(r?.nearby[0]?.longitudinalM).toBeCloseTo(9, 6);
    // Standing still keeps the last heading.
    expect(
      t.next(lmu({ x: 0, y: 0, z: -1.1 }, [other], { tick: 1.3 }))?.nearby[0]?.lateralM,
    ).toBeCloseTo(-3, 6);
  });

  it("skips a car that jumps more than 200 m between frames", () => {
    const t = new ProximityTracker();
    expect(
      t.next(lmu(origin, [{ idx: 1, x: 103, z: -40 }], { yaw: 0, tick: 10 }))?.carLeftRight,
    ).toBe("left");
    const jump = t.next(lmu(origin, [{ idx: 1, x: 103, z: -40 }], { yaw: 0, tick: 10.1 }));
    expect(jump?.carLeftRight).toBe("left");
    // Teleports 300 m away and straight back: the far frame is outside range anyway, the return is skipped.
    t.next(lmu(origin, [{ idx: 1, x: 403, z: -40 }], { yaw: 0, tick: 10.2 }));
    const back = t.next(lmu(origin, [{ idx: 1, x: 103, z: -40 }], { yaw: 0, tick: 10.3 }));
    expect(back?.nearby).toEqual([]);
    expect(
      t.next(lmu(origin, [{ idx: 1, x: 103, z: -40 }], { yaw: 0, tick: 10.4 }))?.carLeftRight,
    ).toBe("left");
  });
});

describe("proximity timing", () => {
  it("stays cheap for 60 cars", () => {
    const t = new ProximityTracker();
    const s = lmu({ x: 0, y: 0, z: 0 }, [], { yaw: 0 });
    for (let i = 1; i < 60; i++) {
      s.cars.push(car(i, { worldPos: { x: (i % 7) * 2 - 6, y: 0, z: -i * 1.5 } }));
    }
    const runs = 400;
    const times: number[] = [];
    for (let i = 0; i < 60; i++) t.next(s);
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      t.next(s);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[runs >> 1] ?? 0;
    console.log(`proximity median ${median.toFixed(4)} ms for 60 cars`);
    expect(median).toBeLessThan(0.15);
  });
});
