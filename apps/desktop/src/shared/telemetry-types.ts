/*
 * Protocol between the main process, the telemetry utility process and overlay renderers.
 *
 * Main -> telemetry process (`utilityProcess.postMessage`):
 *   - `setSource`: pick where frames come from.
 *   - `subscribe`: carries one MessagePort (transferred in the `ports` list); the process then
 *     streams `TelemetryFrame`s over that port. Main normally creates a MessageChannel per
 *     overlay renderer and sends port1 here and port2 to the renderer.
 *   - `stop`: close every subscriber and exit.
 *
 * Telemetry process -> subscriber (over the port): `TelemetryFrame` objects (from sim-core).
 * Subscriber -> telemetry process (over the port): `TelemetryAck` for every frame it has handled.
 * Subscriber -> telemetry process: `TrackOutlineRequest`; the answer is a `TrackOutlineReply` on
 * the same port. It is not a frame, so it does not count towards the ack backpressure and a
 * subscriber that only handles frames ignores it. The outline is large, so frames carry only
 * `derived.track` (the key and whether an outline is ready).
 *
 * Telemetry process -> main (`process.parentPort`): `TelemetryEvent`.
 */

import type { TrackOutline } from "@overlay/sim-core";

export type TelemetrySourceChoice = "auto" | "iracing" | "lmu" | "replay" | "mock";

export const MIN_TELEMETRY_RATE_HZ = 1;
export const MAX_TELEMETRY_RATE_HZ = 60;
export const DEFAULT_TELEMETRY_RATE_HZ = 30;

export type TelemetryCommand =
  | {
      type: "setSource";
      source: TelemetrySourceChoice;
      /** Path of the .ovfx file when `source` is "replay". */
      replayPath?: string;
      /** Playback speed factor, default 1; 0 = as fast as possible. */
      replaySpeed?: number;
      /** Start over when the file ends, default true. */
      replayLoop?: boolean;
    }
  | { type: "subscribe"; rateHz: number }
  | { type: "stop" };

/** Subscriber to telemetry process: this frame has been handled. */
export interface TelemetryAck {
  type: "ack";
  seq: number;
}

/** Subscriber to telemetry process: send the outline of the track being driven. */
export interface TrackOutlineRequest {
  type: "getTrackOutline";
  requestId: number | string;
  /** When given, the reply holds an outline only if it is for this track. */
  trackKey?: string;
}

/**
 * The answer: the cached outline, or null when none is known yet (see `derived.track`) or the
 * request's `trackKey` is not the current track. `requestId` is null when the request had none.
 */
export interface TrackOutlineReply {
  type: "trackOutline";
  requestId: number | string | null;
  outline: TrackOutline | null;
}

/** Telemetry process to main: what the process is doing, for the settings UI and the tray. */
export type TelemetryEvent = {
  type: "status";
  status: "live" | "waiting" | "error";
  source: "iracing" | "lmu" | "replay" | "mock" | null;
  error: string | null;
};

export function clampRateHz(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_TELEMETRY_RATE_HZ;
  return Math.min(MAX_TELEMETRY_RATE_HZ, Math.max(MIN_TELEMETRY_RATE_HZ, n));
}
