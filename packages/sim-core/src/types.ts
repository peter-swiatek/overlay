/** Type-only entry for renderers: nothing here pulls in Node modules. */
export type { Derived, DerivedGap, TelemetryFrame, TelemetryStatus } from "./telemetry/frame";
export type {
  Car,
  CarLeftRight,
  Conditions,
  Flags,
  Player,
  PlayerLapDeltas,
  SessionInfo,
  ShiftLightRpm,
  SimName,
  SimState,
  TrackSurface,
  Vec3,
} from "./model/sim-state";
export type { FuelLapUse, FuelOutputs, FuelPitWindow } from "./calc/fuel/types";
export type { Standings, StandingsEntry, StandingsGap } from "./calc/standings/types";
export type { Proximity, ProximityCar } from "./calc/proximity/types";
export type {
  BestTime,
  DeltaOutputs,
  DeltaReferenceKind,
  DeltaReferenceLap,
  DeltaReferenceMode,
  LapCompletion,
  LiveDelta,
  SectorDeltas,
  SectorState,
  SectorTiming,
} from "./calc/delta/types";
export type { SlowCarAhead } from "./calc/slow-car/types";
export type { LapHistory, LapRecord } from "./calc/laps/types";
export type { TrackOutline } from "./track/types";
export type { Corner } from "./track/corners/schema";
