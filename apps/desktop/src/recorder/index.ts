import { join } from "node:path";
import type { RecorderArgs } from "./args";
import { pruneTelemetryFiles } from "./retention";
import { SessionRecorder } from "./session-recorder";
import { SessionStore } from "./store";

export { parseRecorderArgs, recorderForkArgs, type RecorderArgs } from "./args";
export type { EndReason, FrameRecorder, RecorderFrame } from "./session-recorder";
export { SessionRecorder } from "./session-recorder";

export const DATABASE_FILE = "overlay.db";
export const TELEMETRY_DIR = "telemetry";

/**
 * Opens the tier 1 database, closes sessions a crash left open, prunes old tier 2 files and
 * returns the recorder. Returns null when storage cannot be opened: telemetry then runs on
 * without recording.
 */
export function createRecorder(
  args: RecorderArgs,
  log: (message: string) => void = (m) => console.error(m),
  nowMs: () => number = Date.now,
): SessionRecorder | null {
  if (args.userData === null) return null;
  const telemetryDir = join(args.userData, TELEMETRY_DIR);
  try {
    const pruned = pruneTelemetryFiles(telemetryDir, args.retentionDays, nowMs());
    if (pruned.removed.length > 0) {
      log(
        `recorder: pruned ${pruned.removed.length} telemetry file(s) older than ${args.retentionDays} days`,
      );
    }
  } catch (error) {
    log(`recorder: pruning failed: ${String(error)}`);
  }
  try {
    const store = SessionStore.open(join(args.userData, DATABASE_FILE));
    const closed = store.closeOrphans(nowMs());
    if (closed > 0) log(`recorder: closed ${closed} session(s) left open by a crash`);
    return new SessionRecorder(store, {
      telemetryDir,
      recordSynthetic: args.recordSynthetic,
      nowMs,
      log,
    });
  } catch (error) {
    log(`recorder: storage unavailable, not recording: ${String(error)}`);
    return null;
  }
}
