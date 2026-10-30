export { FuelTracker } from "./tracker";
export {
  computeFuelDelta,
  computeFuelPitWindow,
  computePlusOneLapTarget,
  effectiveFuelAvg,
  estimateFuelTankCapacity,
  estimateRaceLapsRemaining,
  fuelLapsRemaining,
} from "./formulas";
export type {
  FuelContext,
  FuelInvalidReason,
  FuelLapRecord,
  FuelOutputs,
  FuelPitWindow,
  FuelSample,
  FuelTrackerOptions,
} from "./types";
