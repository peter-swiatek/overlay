// Test support only.
import type { TelemetryFrame, VehicleDamage } from "@overlay/sim-core/types";
import { fixtureFrame } from "../shared/fixtures";
import { designTyres } from "../tyres/testing";
import { damage } from "../vehicle-damage/testing";

/** A live LMU frame with the Tyres overlay's design set, a clean car and warm engine. */
export function carFrame(
  options: {
    damage?: VehicleDamage | null;
    waterTempC?: number | null;
    oilTempC?: number | null;
    tyres?: boolean;
  } = {},
): TelemetryFrame {
  return fixtureFrame({
    sim: "lmu",
    cars: [{ carIdx: 0 }],
    playerCarIdx: 0,
    player: {
      tyres: options.tyres === false ? null : designTyres(),
      damage: options.damage === undefined ? damage() : options.damage,
      waterTempC: options.waterTempC === undefined ? 86 : options.waterTempC,
      oilTempC: options.oilTempC === undefined ? 101 : options.oilTempC,
    },
  });
}

/** Damage with the repair screen's values on top of the dents. */
export function restDamage(
  dents: readonly number[],
  aero: number | null,
  suspension: VehicleDamage["suspension"],
): VehicleDamage {
  return { ...damage(dents), aero, suspension };
}
