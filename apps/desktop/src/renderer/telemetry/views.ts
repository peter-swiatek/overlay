import type { TelemetryFrame } from "@overlay/sim-core/types";

/** What an overlay shows instead of data, or null when the frame is live. */
export function statusNotice(frame: TelemetryFrame | null, stale = false): string | null {
  if (stale) return "No data";
  if (frame === null || frame.status === "waiting") return "Waiting for sim";
  if (frame.status === "error") return frame.error ?? "Telemetry error";
  return null;
}
