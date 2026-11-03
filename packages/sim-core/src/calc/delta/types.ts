/** Points per lap trace: bin k is lap distance k / LAP_TRACE_BINS (bin 0 is the line). */
export const LAP_TRACE_BINS = 400;

/** One lap sampled by lap distance. Both arrays have LAP_TRACE_BINS entries. */
export interface LapTrace {
  /** Seconds since the line when the car reached bin k; timeS[0] is 0; non-decreasing. */
  timeS: number[];
  /** Speed at bin k, m/s. */
  speedMps: number[];
}

/** The laps a live delta can be measured against. */
export type DeltaReferenceKind = "allTimeBest" | "sessionBestClean" | "sessionBest" | "lastLap";

/** The Delta Bar's "Reference" option; values are stored as they are. */
export type DeltaReferenceMode = "auto" | "sessionBest" | "allTimeBest" | "lastLap";

export interface DeltaReferenceLap {
  kind: DeltaReferenceKind;
  lapTimeS: number;
  /** A distance trace exists, so a computed delta and the delta speed are possible. */
  hasTrace: boolean;
}

export interface LiveDelta {
  /** Seconds against the reference at this point of the lap; negative = ahead. Null: show "--". */
  deltaS: number | null;
  /** Rate of change of deltaS in s/s, clamped to -1..1; null when unknown. */
  rate: number | null;
  /** Speed now minus the reference lap's speed at the same lap distance, m/s; null without a trace. */
  speedDeltaMps: number | null;
  /** "sim": the sim's own channel; "computed": from the reference trace. Null when deltaS is null. */
  source: "sim" | "computed" | null;
}

/** The lap that was completed last; kept until the next one completes. */
export interface LapCompletion {
  /** Number of the completed lap (its lapInProgress while it was driven). */
  lapNumber: number;
  /** The sim's lap time; null when it never arrived or the sim gave none. */
  lapTimeS: number | null;
  /** See "clean lap" in the plan: no new incidents, never off track, never on pit road. */
  clean: boolean;
  /** Reference lap times in force at 97 % of that lap (at the line if it never got there). */
  references: Partial<Record<DeltaReferenceKind, number>>;
  /** What auto picked at that moment. */
  autoKind: DeltaReferenceKind | null;
  /** tickTimeS when the lap time arrived; null when unknown. */
  completedAtS: number | null;
}

export interface BestTime {
  lapTimeS: number | null;
  /** Last lap minus this best as it stood before the last lap; null while hidden or unknown. */
  lastLapDeltaS: number | null;
  /** The last completed lap set this best. */
  setByLastLap: boolean;
}

/** Published as Derived.delta; null until the player has lap data. */
export interface DeltaOutputs {
  /** References available now; a missing kind has no valid lap. */
  references: Partial<Record<DeltaReferenceKind, DeltaReferenceLap>>;
  /** Live delta against each available reference. */
  live: Partial<Record<DeltaReferenceKind, LiveDelta>>;
  /** What "auto" picks now (autoReferenceKind); null when nothing is available. */
  autoKind: DeltaReferenceKind | null;
  /** Lap in progress (1 = first lap); null when unknown. */
  lapNumber: number | null;
  /** Seconds into the current lap. */
  currentLapS: number | null;
  /** The sim's last lap time. */
  lastLapS: number | null;
  /** The current lap began on pit road or in the pit stall. */
  outLap: boolean;
  /** From 97 % of the lap until the new lap time arrives (best-time deltas are hidden). */
  closingLap: boolean;
  /** The current lap is clean so far. */
  currentLapClean: boolean;
  allTimeBest: BestTime;
  /** Session best clean lap, else session best. */
  sessionBest: BestTime;
  lastCompletion: LapCompletion | null;
  /** The lap-complete strip should show now (rules in DS-32). */
  lapCompleteVisible: boolean;
  /** Sum of the best sector times of this session's clean laps; null before one. */
  optimalLapS: number | null;
}

/** A stored all-time best lap. */
export interface BestLapRecord {
  lapTimeS: number;
  /** Null when the time came from the sim's own best lap. */
  trace: LapTrace | null;
}

/** Where all-time bests are kept; the telemetry process provides a file-backed one. */
export interface BestLapStore {
  /** Synchronous; called when the car/track key changes, never per tick. */
  load(key: string): BestLapRecord | null;
  /** Must not block the tick (queue the write). Never replaces a faster stored lap. */
  record(key: string, lap: BestLapRecord): void;
}
