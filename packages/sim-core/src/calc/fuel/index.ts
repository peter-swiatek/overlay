export { FuelTracker } from "./tracker";
export {
  computeFuelDelta,
  computeFuelPitWindow,
  computeLapTargets,
  computeRefuel,
  computePlusOneLapTarget,
  effectiveFuelAvg,
  estimateFuelTankCapacity,
  estimateRaceLapsRemaining,
  fuelLapsRemaining,
  lapsPerTank,
} from "./formulas";
export type {
  FuelContext,
  FuelLapUse,
  FuelInvalidReason,
  FuelLapRecord,
  FuelOutputs,
  FuelPitWindow,
  FuelSample,
  FuelTrackerOptions,
} from "./types";
