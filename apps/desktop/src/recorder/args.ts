import { normalizeRetentionDays } from "./retention";

/** What main tells the telemetry process about storage: it has no `app`, so no userData path. */
export interface RecorderArgs {
  userData: string | null;
  retentionDays: number;
  /** Debug: record replay and mock sources too. */
  recordSynthetic: boolean;
}

const USER_DATA = "--user-data=";
const RETENTION = "--retention-days=";
const RECORD_REPLAY = "--record-replay";

export function recorderForkArgs(args: RecorderArgs): string[] {
  const out: string[] = [];
  if (args.userData !== null) out.push(`${USER_DATA}${args.userData}`);
  out.push(`${RETENTION}${normalizeRetentionDays(args.retentionDays)}`);
  if (args.recordSynthetic) out.push(RECORD_REPLAY);
  return out;
}

export function parseRecorderArgs(argv: readonly string[]): RecorderArgs {
  let userData: string | null = null;
  let retention: number | undefined;
  for (const arg of argv) {
    if (arg.startsWith(USER_DATA) && arg.length > USER_DATA.length) {
      userData = arg.slice(USER_DATA.length);
    } else if (arg.startsWith(RETENTION)) {
      retention = Number(arg.slice(RETENTION.length));
    }
  }
  return {
    userData,
    retentionDays: normalizeRetentionDays(retention),
    recordSynthetic: argv.includes(RECORD_REPLAY),
  };
}
