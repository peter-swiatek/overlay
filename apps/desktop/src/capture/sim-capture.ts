import type { SimId } from "@overlay/sim-core";

/** Receives record payloads for the file currently being written. */
export interface RecordSink {
  write(kind: number, payload: Uint8Array | string | object): Promise<void>;
}

/** No signal for this long: close our handles so a dead sim does not look alive forever. */
export const STALE_CLOSE_MS = 10_000;

export interface SimCapture {
  readonly sim: SimId;
  /** True when the sim is running and producing data right now. */
  readonly live: boolean;
  /** True while we hold any handle on the sim's objects. */
  readonly isOpen: boolean;
  /** Frames (or var buffers) written to the current file. */
  readonly frames: number;
  /**
   * Cheap liveness check, called about every 2 s. `capturing` is true while this capture is the
   * one writing a file, in which case `step` already supplies the signals.
   */
  probe(capturing: boolean): Promise<void>;
  /** Extra header fields to stamp into a new file (mapping sizes and so on). */
  headerExtras(): Record<string, unknown>;
  /** Called after a new file is opened; resets per-file state so the file is self-contained. */
  beginFile(sink: RecordSink): Promise<void>;
  /** One unit of work: wait for new data, copy it, write it. */
  step(): Promise<void>;
  /** The user picked "Mark moment". */
  onMarker(): void;
  /** Called before the file is closed. Resolves once no write is in flight. */
  endFile(): Promise<Record<string, unknown>>;
  /** Closes all handles. */
  close(): void;
}
