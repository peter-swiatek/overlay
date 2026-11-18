// Test support only.
import type { TelemetryFrame, VehicleDamage } from "@overlay/sim-core/types";
import { fixtureFrame } from "../shared/fixtures";

export function damage(
  dents: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0],
  flat: Partial<VehicleDamage["tyreFlat"]> = {},
  lastImpactS: number | null = null,
): VehicleDamage {
  const d = (i: number) => dents[i] ?? 0;
  return {
    dents: [d(0), d(1), d(2), d(3), d(4), d(5), d(6), d(7)],
    tyreFlat: { fl: false, fr: false, rl: false, rr: false, ...flat },
    lastImpactS,
  };
}

/** A live LMU frame at session time `tickTimeS` with the given damage. */
export function damageFrame(d: VehicleDamage | null, tickTimeS = 400): TelemetryFrame {
  const f = fixtureFrame({
    sim: "lmu",
    cars: [{ carIdx: 0 }],
    playerCarIdx: 0,
    player: { damage: d },
  });
  f.state.tickTimeS = tickTimeS;
  return f;
}
