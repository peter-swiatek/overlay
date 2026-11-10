import type { Car, CarLeftRight, SimState, Vec3 } from "../../model";
import { wrapPctDiff } from "../gaps/relativeGap";
import type { Proximity, ProximityCar } from "./types";

export * from "./types";

/**
 * Typical car length. GT3 is about 4.6 m, Hypercar about 5.0 m; per-class lengths can come later.
 * The reference gives no formula for the spotter, so this and the thresholds below are our choice.
 */
export const CAR_LENGTH_M = 4.8;
/** Cars this far along the track (either way) are listed in `nearby`; the radar's largest range. */
export const NEARBY_M = 40;
/** A car counts as alongside when its centre is closer than this many car lengths along the track. */
const ALONGSIDE_LENGTHS = 1.5;
/** LMU: sideways centre distance of a car on a side (closer is a collision, further is a lane away). */
const SIDE_MIN_M = 1.0;
const SIDE_MAX_M = 4.0;
/** Cars unseen for this long (session time) lose their remembered side. */
const MEMORY_S = 5;
const MIN_HEADING_STEP_M = 0.5;
const JUMP_M = 200;
const JUMP_WINDOW_S = 0.1;
const MAX_JUMP_DT_S = 1;

/**
 * Sign of "right" in the LMU / rFactor 2 ground plane (x/z, y up).
 *
 * The rFactor 2 coordinate system is left-handed: in the car's local frame +x points to the driver's
 * left, +y up and +z to the rear (the nose points to -z). A rotation about y keeps that relation, so
 * for a ground heading F = (fx, fz) the car's left is (-fz, fx) and its right is (fz, -fx). The
 * sideways distance of an offset d is therefore d.x * fz - d.z * fx, times this constant. Set it to -1
 * if on track a car on the left lights the right bar: it flips every LMU side at once.
 */
export const LMU_RIGHT_SIGN = 1;

/**
 * When the sim gives a heading (`yawRad`) we take north to be -z, the direction rFactor 2 cars face
 * at yaw 0. The ground plane is left-handed, so a clockwise turn from above (north towards east)
 * moves the nose towards -x: F = (-sin yaw, -cos yaw). The LMU decoder fills yawRad from the
 * orientation matrix with that same convention (verified against the direction of motion).
 */
export function headingFromYaw(yawRad: number): [number, number] {
  return [-Math.sin(yawRad), -Math.cos(yawRad)];
}

interface Remembered {
  side: "left" | "right";
  lastSeenS: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function byDistance(a: ProximityCar, b: ProximityCar): number {
  return Math.abs(a.longitudinalM) - Math.abs(b.longitudinalM) || a.carIdx - b.carIdx;
}

function offset(car: ProximityCar): number {
  return clamp(car.longitudinalM / CAR_LENGTH_M, -1, 1);
}

function eligible(car: Car, playerCarIdx: number, playerOnPit: boolean): boolean {
  if (car.carIdx === playerCarIdx || !car.connected || car.isPaceCar === true) return false;
  if (car.isOnTrack === false || car.lapDistPct === null) return false;
  return (car.onPitRoad === true) === playerOnPit;
}

function callFromCounts(left: number, right: number): CarLeftRight {
  if (left > 0 && right > 0) return "both";
  if (left > 1) return "twoLeft";
  if (right > 1) return "twoRight";
  if (left === 1) return "left";
  if (right === 1) return "right";
  return "clear";
}

export class ProximityTracker {
  /** Last side each car was given by a one-sided call (iRacing). */
  private readonly memory = new Map<number, Remembered>();
  private lastTickS: number | null = null;

  // LMU heading from motion: the position the heading was last measured from.
  private heldX = 0;
  private heldZ = 0;
  private hasHeld = false;
  private headingX = 0;
  private headingZ = 0;
  private hasHeading = false;

  // LMU jump filter: previous ground position and time per carIdx.
  private readonly prevX: number[] = [];
  private readonly prevZ: number[] = [];
  private readonly prevT: number[] = [];

  reset(): void {
    this.memory.clear();
    this.lastTickS = null;
    this.hasHeld = false;
    this.hasHeading = false;
    this.prevX.length = 0;
    this.prevZ.length = 0;
    this.prevT.length = 0;
  }

  next(state: SimState): Proximity | null {
    if (!state.connected || state.playerCarIdx === null) return null;
    const playerIdx = state.playerCarIdx;
    let player: Car | undefined;
    for (const car of state.cars) {
      if (car.carIdx === playerIdx) {
        player = car;
        break;
      }
    }
    // Not in the world (garage, disconnected): no spotter. In the pits is fine; the pit-road rule
    // in `eligible` pairs the player with cars on pit road.
    if (
      player === undefined ||
      player.lapDistPct === null ||
      !player.connected ||
      player.isOnTrack === false
    ) {
      return null;
    }
    const pitRoad = player.onPitRoad === true;
    const tickS = state.tickTimeS;
    if (tickS !== null && this.lastTickS !== null && tickS < this.lastTickS) this.memory.clear();
    this.lastTickS = tickS;

    // A sim that makes its own spotter call (iRacing, and the mock, which also has a player
    // position for the track outline) is followed; positions are used only when it makes none.
    if (state.player.worldPos !== null && state.player.carLeftRight === null) {
      return this.fromPositions(state, playerIdx, pitRoad, state.player.worldPos);
    }
    return this.fromLapDistance(state, player, player.lapDistPct, pitRoad, tickS);
  }

  // iRacing -----------------------------------------------------------------------------------

  private fromLapDistance(
    state: SimState,
    player: Car,
    playerPct: number,
    pitRoad: boolean,
    tickS: number | null,
  ): Proximity {
    const call: CarLeftRight = state.player.carLeftRight ?? "clear";
    const lengthM = state.session.trackLengthM;
    if (lengthM === null || lengthM <= 0) {
      return { carLeftRight: call, left: null, right: null, nearby: [], carLengthM: CAR_LENGTH_M };
    }
    const alongsideM = ALONGSIDE_LENGTHS * CAR_LENGTH_M;
    const nearby: ProximityCar[] = [];
    for (const car of state.cars) {
      if (car.lapDistPct === null || !eligible(car, player.carIdx, pitRoad)) continue;
      const longitudinalM = wrapPctDiff(car.lapDistPct - playerPct) * lengthM;
      if (Math.abs(longitudinalM) <= NEARBY_M) {
        nearby.push({ carIdx: car.carIdx, longitudinalM, lateralM: null, side: null });
      }
    }
    nearby.sort(byDistance);
    const first =
      nearby[0] !== undefined && Math.abs(nearby[0].longitudinalM) < alongsideM
        ? nearby[0]
        : undefined;
    const second =
      nearby[1] !== undefined && Math.abs(nearby[1].longitudinalM) < alongsideM
        ? nearby[1]
        : undefined;
    if (tickS !== null) this.expireMemory(nearby, tickS);

    let left: ProximityCar | undefined;
    let right: ProximityCar | undefined;
    let leftZero = false;
    let rightZero = false;
    switch (call) {
      case "clear":
        break;
      case "left":
      case "twoLeft":
        left = first;
        leftZero = first === undefined;
        break;
      case "right":
      case "twoRight":
        right = first;
        rightZero = first === undefined;
        break;
      case "both":
        if (first === undefined) {
          leftZero = rightZero = true;
        } else if (second === undefined) {
          left = right = first;
        } else {
          [left, right] = this.assignBoth(first, second);
        }
        break;
    }
    if (first !== undefined && tickS !== null && call !== "clear" && call !== "both") {
      this.memory.set(first.carIdx, {
        side: call === "left" || call === "twoLeft" ? "left" : "right",
        lastSeenS: tickS,
      });
    }
    // A single car lighting both bars has no side of its own.
    if (left !== undefined && left !== right) left.side = "left";
    if (right !== undefined && left !== right) right.side = "right";
    return {
      carLeftRight: call,
      left: left ? offset(left) : leftZero ? 0 : null,
      right: right ? offset(right) : rightZero ? 0 : null,
      nearby,
      carLengthM: CAR_LENGTH_M,
    };
  }

  /**
   * Two cars alongside on a "both" call. A car keeps the side a one-sided call gave it. Without a
   * usable memory the car with the lower carIdx goes on the left (arbitrary but stable).
   */
  private assignBoth(a: ProximityCar, b: ProximityCar): [ProximityCar, ProximityCar] {
    const sideA = this.memory.get(a.carIdx)?.side;
    const sideB = this.memory.get(b.carIdx)?.side;
    let aLeft: boolean;
    if (sideA !== undefined && sideB !== undefined) {
      aLeft = sideA === sideB ? a.carIdx < b.carIdx : sideA === "left";
    } else if (sideA !== undefined) {
      aLeft = sideA === "left";
    } else if (sideB !== undefined) {
      aLeft = sideB === "right";
    } else {
      aLeft = a.carIdx < b.carIdx;
    }
    return aLeft ? [a, b] : [b, a];
  }

  private expireMemory(nearby: readonly ProximityCar[], tickS: number): void {
    if (this.memory.size === 0) return;
    for (const c of nearby) {
      const m = this.memory.get(c.carIdx);
      if (m) m.lastSeenS = tickS;
    }
    for (const [carIdx, m] of this.memory) {
      if (tickS - m.lastSeenS > MEMORY_S) this.memory.delete(carIdx);
    }
  }

  // LMU ---------------------------------------------------------------------------------------

  private fromPositions(
    state: SimState,
    playerIdx: number,
    pitRoad: boolean,
    pos: Vec3,
  ): Proximity | null {
    const yaw = state.player.yawRad;
    if (yaw !== null) {
      [this.headingX, this.headingZ] = headingFromYaw(yaw);
      this.hasHeading = true;
    } else {
      this.updateHeadingFromMotion(pos);
    }
    if (!this.hasHeading) return null;
    const fx = this.headingX;
    const fz = this.headingZ;
    const tickS = state.tickTimeS;
    const alongsideM = ALONGSIDE_LENGTHS * CAR_LENGTH_M;

    const nearby: ProximityCar[] = [];
    let leftCount = 0;
    let rightCount = 0;
    let left: ProximityCar | null = null;
    let right: ProximityCar | null = null;
    for (const car of state.cars) {
      const p = car.worldPos;
      if (p === null || !eligible(car, playerIdx, pitRoad)) continue;
      if (this.jumped(car.carIdx, p, tickS)) continue;
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const longitudinalM = dx * fx + dz * fz;
      if (Math.abs(longitudinalM) > NEARBY_M) continue;
      const lateralM = LMU_RIGHT_SIGN * (dx * fz - dz * fx);
      const entry: ProximityCar = { carIdx: car.carIdx, longitudinalM, lateralM, side: null };
      const abs = Math.abs(lateralM);
      if (abs >= SIDE_MIN_M && abs <= SIDE_MAX_M && Math.abs(longitudinalM) < alongsideM) {
        if (lateralM < 0) {
          entry.side = "left";
          leftCount++;
          if (left === null || byDistance(entry, left) < 0) left = entry;
        } else {
          entry.side = "right";
          rightCount++;
          if (right === null || byDistance(entry, right) < 0) right = entry;
        }
      }
      nearby.push(entry);
    }
    nearby.sort(byDistance);
    return {
      carLeftRight: callFromCounts(leftCount, rightCount),
      left: left ? offset(left) : null,
      right: right ? offset(right) : null,
      nearby,
      carLengthM: CAR_LENGTH_M,
    };
  }

  private updateHeadingFromMotion(pos: Vec3): void {
    if (!this.hasHeld) {
      this.heldX = pos.x;
      this.heldZ = pos.z;
      this.hasHeld = true;
      return;
    }
    const dx = pos.x - this.heldX;
    const dz = pos.z - this.heldZ;
    const dist = Math.hypot(dx, dz);
    if (dist < MIN_HEADING_STEP_M) return;
    this.headingX = dx / dist;
    this.headingZ = dz / dist;
    this.hasHeading = true;
    this.heldX = pos.x;
    this.heldZ = pos.z;
  }

  /** True when the car moved implausibly far since the last frame; records the new position either way. */
  private jumped(carIdx: number, p: Vec3, tickS: number | null): boolean {
    const t = tickS ?? 0;
    const px = this.prevX[carIdx];
    const pz = this.prevZ[carIdx];
    const pt = this.prevT[carIdx];
    this.prevX[carIdx] = p.x;
    this.prevZ[carIdx] = p.z;
    this.prevT[carIdx] = t;
    if (px === undefined || pz === undefined || pt === undefined) return false;
    const dt = t - pt;
    if (dt < 0 || dt > MAX_JUMP_DT_S) return false;
    const dist = Math.hypot(p.x - px, p.z - pz);
    return dist > JUMP_M && dist > (JUMP_M * dt) / JUMP_WINDOW_S;
  }
}
