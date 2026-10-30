import type { SimState } from "@overlay/sim-core";

export interface SourceFrame {
  state: SimState;
  /** Set when the sim is there but the frame could not be decoded; the engine publishes status "error". */
  error?: string | null;
  /** The source started over (a replay looped): derived history from before must be dropped. */
  restart?: boolean;
}

/** Anything that produces SimStates, live or not. */
export interface TelemetrySource {
  readonly id: "iracing" | "lmu" | "replay" | "mock";
  /** Delay before the next `read`; 0 when `read` waits for the data by itself. */
  readonly pollIntervalMs: number;
  /** The next frame, or null when there is none yet (or a torn one was dropped). */
  read(): Promise<SourceFrame | null>;
  /**
   * True when a connected source has stopped delivering new data for a while (a sim that
   * crashed or hung); the engine then publishes "waiting" at once.
   */
  readonly stalled?: boolean;
  /** True once a non-looping source has delivered everything. */
  readonly ended?: boolean;
  /** Releases handles and workers; the source can be used again, it reopens on demand. */
  close(): void;
}

/** A sim that may or may not be running, checked about once a second. */
export interface LiveSource extends TelemetrySource {
  readonly id: "iracing" | "lmu";
  /** Cheap check that also opens or closes handles; true when the sim is live right now. */
  probe(): boolean;
}
