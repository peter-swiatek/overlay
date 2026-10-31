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
export {
  FUEL_HISTORY_LAPS,
  FUEL_HISTORY_MAX_KEYS,
  addHistoryLap,
  fuelHistoryKey,
  historyLaps,
  parseFuelHistory,
} from "./history";
export type { FuelHistoryFile, FuelHistoryKind, FuelHistoryStore, SeedLap } from "./history";
