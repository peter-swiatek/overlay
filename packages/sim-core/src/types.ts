/** Type-only entry for renderers: nothing here pulls in Node modules. */
export type { Derived, DerivedGap, TelemetryFrame, TelemetryStatus } from "./telemetry/frame";
export type {
  Car,
  CarLeftRight,
  Conditions,
  Flags,
  Player,
  SessionInfo,
  SimName,
  SimState,
  Vec3,
} from "./model/sim-state";
export type { FuelLapUse, FuelOutputs, FuelPitWindow } from "./calc/fuel/types";
export type { Standings, StandingsEntry, StandingsGap } from "./calc/standings/types";
export type { Proximity, ProximityCar } from "./calc/proximity/types";
