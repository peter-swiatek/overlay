import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildLogHeader,
  createUuidv7Generator,
  fieldSlotsFor,
  IncidentTracker,
  LapAccumulator,
  lastLapMoved,
  lapInProgress,
  OtlmWriter,
  PitStopTracker,
  playerCar,
  StintTracker,
  TelemetrySampler,
  type FuelLapRecord,
  type LapSummary,
  type SimSource,
  type SimState,
} from "@overlay/sim-core";
import { FileSink, openTier2File, tier2RelativePath, writeManifest } from "./files";
import { recordingSim } from "./sim";
import { SessionStore, type NewLap, type SessionPatch } from "./store";

export type EndReason = "sessionChange" | "sourceSwitch" | "stop" | "crash";

/** What the telemetry engine hands over for each live frame. */
export interface RecorderFrame {
  source: SimSource;
  state: SimState;
  /** The Deriver's session counter; a change means a new session. */
  sessionNum: number;
  /** The fuel tracker's lap records so far (the tracker is replaced when the Deriver resets). */
  fuelLaps: readonly FuelLapRecord[];
}

/** The engine's view of the recorder. */
export interface FrameRecorder {
  onFrame(frame: RecorderFrame): void;
  /** Closes the open session, if any. */
  end(reason: EndReason): void;
}

export interface SessionRecorderOptions {
  /** Directory of the tier 2 files, `<userData>/telemetry`. Null turns tier 2 off. */
  telemetryDir: string | null;
  /** Record replay and mock sources too (a debug aid; recordings must not record themselves). */
  recordSynthetic?: boolean;
  /** How often queued rows and full chunks are written. Default 2000. */
  flushIntervalMs?: number;
  /** A session with no laps, stops or incidents shorter than this (session seconds) is dropped. Default 10. */
  minSessionS?: number;
  /** A chunk that is not full is written once it has waited this long. Default 10000. */
  partialChunkMs?: number;
  nowMs?: () => number;
  log?: (message: string) => void;
}

/** Sim name of a replay that has not shown yet which sim it came from (see `recordingSim`). */
const UNKNOWN_SIM = "replay";

/** A session this short with no rows is a connection flicker, not a session. */
const MIN_USEFUL_SESSION_S = 10;
/** How long, in session seconds, a lap waits for the sim to report its time. */
const LAP_TIME_WAIT_S = 2;
/** Session metadata is re-read this often (session seconds). */
const META_INTERVAL_S = 1;
/** After this many errors in a row the recorder stops trying. */
const MAX_FAILURES = 5;
/** A recording stays open this long (ms) while its source is away, for the same sim to come back. */
const RESUME_WINDOW_MS = 60_000;
/** Rows waiting for the database beyond this mean it is not coming back; recording stops. */
const MAX_QUEUED_OPS = 200_000;

interface PendingLap {
  row: NewLap;
  summary: LapSummary;
  baseline: number | null;
  deadlineS: number | null;
}

interface ActiveSession {
  id: string;
  sim: string;
  source: SimSource;
  sessionNum: number;
  startedAt: number;
  fuelCursor: number;
  laps: LapAccumulator;
  incidents: IncidentTracker;
  pits: PitStopTracker;
  stints: StintTracker;
  stintId: string;
  stintNumber: number;
  pending: PendingLap[];
  meta: Omit<SessionPatch, "sim">;
  lastMetaS: number | null;
  firstTickS: number | null;
  lastTickS: number | null;
  /** Highest lap in progress seen: the counter drops after the flag and in the garage. */
  maxLap: number;
  lastLastLapS: number | null;
  rowsWritten: number;
  lapIndex: number;
  air: Mean;
  track: Mean;
  wetnessMax: number | null;
  tier2Path: string | null;
  tier2: {
    writer: OtlmWriter;
    sink: FileSink;
    sampler: TelemetrySampler;
    flushedAt: number;
  } | null;
}

class Mean {
  private sum = 0;
  private n = 0;
  add(value: number | null): void {
    if (value === null || !Number.isFinite(value)) return;
    this.sum += value;
    this.n++;
  }
  get value(): number | null {
    return this.n === 0 ? null : this.sum / this.n;
  }
}

/**
 * Turns the frame stream of the telemetry engine into tier 1 rows and a tier 2 file. Lap detection
 * stays with the fuel tracker: this class reads its records and adds what they lack.
 *
 * Nothing here touches the disk on the tick path except copying numbers into memory: rows are
 * queued, and `flush` (on a timer, and when a session ends) writes them in one transaction and
 * compresses the tier 2 chunks.
 */
export class SessionRecorder implements FrameRecorder {
  private active: ActiveSession | null = null;
  private queue: ((nowMs: number) => void)[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Consecutive errors per kind of work, so that frames succeeding do not hide a failing disk. */
  private readonly failures = { frame: 0, flush: 0 };
  private disabled = false;
  /** The source went away at this time; the session stays open for a while in case it returns. */
  private suspended: { reason: EndReason; atMs: number } | null = null;
  private readonly newId = createUuidv7Generator();
  private readonly now: () => number;

  constructor(
    private readonly store: SessionStore,
    private readonly options: SessionRecorderOptions,
  ) {
    this.now = options.nowMs ?? Date.now;
    this.timer = setInterval(() => this.flush(), options.flushIntervalMs ?? 2000);
    this.timer.unref?.();
  }

  /** The session being recorded, for tests and diagnostics. */
  get activeSessionId(): string | null {
    return this.active?.id ?? null;
  }

  onFrame(frame: RecorderFrame): void {
    if (this.disabled || !this.wants(frame.source)) return;
    if (!frame.state.connected) return;
    this.guard(() => {
      const active = this.active;
      if (active !== null) {
        const sameSession =
          active.sessionNum === frame.sessionNum && active.source === frame.source;
        const back =
          this.suspended === null || this.now() - this.suspended.atMs <= RESUME_WINDOW_MS;
        if (sameSession && back) this.suspended = null;
        else this.finishOpen(this.suspended === null ? "sessionChange" : null);
      }
      this.active ??= this.open(frame);
      this.track(this.active, frame);
    });
  }

  /**
   * The engine says the source went away. A live sim that comes back within a minute with the
   * same session number continues the same recording; anything else closes it.
   */
  end(reason: EndReason): void {
    if (this.active === null) return;
    if (reason === "sourceSwitch") {
      this.suspended ??= { reason, atMs: this.now() };
      return;
    }
    this.guard(() => this.finishOpen(reason));
  }

  /** Closes the open session with its own reason when it was suspended, else with `reason`. */
  private finishOpen(reason: EndReason | null): void {
    const suspended = this.suspended;
    this.suspended = null;
    if (suspended !== null) this.finish(suspended.reason, suspended.atMs);
    else this.finish(reason ?? "sessionChange");
  }

  /** Writes what is queued and every full tier 2 chunk. */
  flush(): void {
    if (this.disabled) return;
    const suspended = this.suspended;
    if (suspended !== null && this.now() - suspended.atMs > RESUME_WINDOW_MS) {
      this.guard(() => this.finishOpen(null));
    }
    this.guard(() => this.flushNow(), "flush");
  }

  /** Ends the session, writes everything and closes the database. */
  shutdown(reason: EndReason = "stop"): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.guard(() => this.finishOpen(reason));
    this.guard(() => this.flushNow(), "flush");
    try {
      this.store.close();
    } catch (error) {
      this.options.log?.(`recorder: closing the database failed: ${String(error)}`);
    }
    this.disabled = true;
  }

  private wants(source: SimSource): boolean {
    return (source !== "replay" && source !== "mock") || this.options.recordSynthetic === true;
  }

  /** Recording must never break telemetry: errors are logged and, if they keep coming, stop it. */
  private guard(work: () => boolean | void, kind: "frame" | "flush" = "frame"): void {
    try {
      // An empty flush proves nothing about the disk, so it does not clear the failure count.
      if (work() !== false) this.failures[kind] = 0;
    } catch (error) {
      this.failures[kind]++;
      this.options.log?.(`recorder: ${String(error)}`);
      if (this.failures[kind] >= MAX_FAILURES) {
        this.disabled = true;
        this.queue = [];
        this.abandon();
        this.options.log?.("recorder: too many errors, recording stopped until restart");
      }
    }
  }

  /** Lets go of the open session without writing more (the files stay as they are). */
  private abandon(): void {
    const files = this.active?.tier2;
    this.active = null;
    try {
      files?.sink.close();
    } catch {
      // Nothing more can be done for a file that will not close.
    }
  }

  // ---- Opening ------------------------------------------------------------------------------

  private open(frame: RecorderFrame): ActiveSession {
    const { state } = frame;
    const startedAt = this.now();
    const id = this.newId(startedAt);
    const sim = recordingSim(frame.source, state);
    const meta = sessionMeta(state);
    const player = playerCar(state);
    const lap = player === null ? 0 : lapInProgress(player);
    const stintId = this.newId(startedAt);
    const tier2 = this.openTier2(id, sim, startedAt, state);

    const session: ActiveSession = {
      id,
      sim,
      source: frame.source,
      sessionNum: frame.sessionNum,
      startedAt,
      // History from before this session opened (a pause that closed it) is not rewritten.
      fuelCursor: frame.fuelLaps.length,
      laps: new LapAccumulator(),
      incidents: new IncidentTracker(),
      pits: new PitStopTracker(),
      stints: new StintTracker(),
      stintId,
      stintNumber: 1,
      pending: [],
      meta,
      lastMetaS: state.tickTimeS,
      firstTickS: state.tickTimeS,
      lastTickS: state.tickTimeS,
      maxLap: lap,
      lastLastLapS: player?.lastLapS ?? null,
      rowsWritten: 0,
      lapIndex: 0,
      air: new Mean(),
      track: new Mean(),
      wetnessMax: null,
      tier2Path: tier2?.path ?? null,
      tier2: tier2?.files ?? null,
    };
    this.enqueue((now) => {
      this.store.insertSession(
        {
          id,
          sim,
          source: frame.source,
          started_at: startedAt,
          tier2_path: session.tier2Path,
          ...meta,
        },
        now,
      );
      this.store.insertStint(
        {
          id: stintId,
          session_id: id,
          stint_number: 1,
          start_lap: lap,
          fuel_added_at_start_l: null,
        },
        now,
      );
    });
    return session;
  }

  private openTier2(
    id: string,
    sim: string,
    startedAt: number,
    state: SimState,
  ): { path: string; files: NonNullable<ActiveSession["tier2"]> } | null {
    const dir = this.options.telemetryDir;
    if (dir === null) return null;
    try {
      const path = tier2RelativePath(sim, startedAt, id);
      const sink = openTier2File(dir, path);
      const slots = fieldSlotsFor(state);
      const writer = new OtlmWriter(
        sink,
        buildLogHeader({ sessionId: id, sim, startedAt, fieldSlots: slots }),
      );
      return {
        path,
        files: {
          writer,
          sink,
          sampler: new TelemetrySampler(writer, slots),
          flushedAt: this.now(),
        },
      };
    } catch (error) {
      this.options.log?.(`recorder: telemetry file not created: ${String(error)}`);
      return null;
    }
  }

  // ---- Per frame ----------------------------------------------------------------------------

  private track(s: ActiveSession, frame: RecorderFrame): void {
    const { state } = frame;
    const tick = state.tickTimeS;
    const player = playerCar(state);
    if (tick !== null) {
      s.firstTickS ??= tick;
      s.lastTickS = tick;
    }
    if (player !== null) s.maxLap = Math.max(s.maxLap, lapInProgress(player));
    this.trackSim(s, frame);
    s.air.add(state.conditions.airTempC);
    s.track.add(state.conditions.trackTempC);
    const wet = state.conditions.wetness;
    if (wet !== null) s.wetnessMax = Math.max(s.wetnessMax ?? wet, wet);

    this.trackMeta(s, state);
    s.laps.observe(state);
    this.trackLaps(s, frame);
    this.resolvePending(s, state);
    this.trackIncidents(s, state);
    this.trackPits(s, state);
    this.sampleTier2(s, state);
    s.lastLastLapS = player?.lastLapS ?? s.lastLastLapS;
  }

  /** A replay of an unknown sim is looked at again until its state shows which sim it is. */
  private trackSim(s: ActiveSession, frame: RecorderFrame): void {
    if (s.sim !== UNKNOWN_SIM) return;
    const sim = recordingSim(frame.source, frame.state);
    if (sim === s.sim) return;
    s.sim = sim;
    this.enqueue((now) => this.store.updateSession(s.id, { sim }, now));
  }

  /** A failing tier 2 file ends tier 2 for this session; tier 1 carries on. */
  private sampleTier2(s: ActiveSession, state: SimState): void {
    try {
      s.tier2?.sampler.accept(state);
    } catch (error) {
      this.dropTier2(s, error);
    }
  }

  private dropTier2(s: ActiveSession, error: unknown): void {
    this.options.log?.(`recorder: telemetry file abandoned: ${String(error)}`);
    const files = s.tier2;
    s.tier2 = null;
    try {
      files?.sink.close();
    } catch {
      // Nothing more can be done for a file that will not close.
    }
  }

  private trackMeta(s: ActiveSession, state: SimState): void {
    const tick = state.tickTimeS;
    const due =
      tick === null ||
      s.lastMetaS === null ||
      tick < s.lastMetaS ||
      tick - s.lastMetaS >= META_INTERVAL_S;
    if (!due) return;
    s.lastMetaS = tick;
    const next = sessionMeta(state);
    // The YAML may arrive after the first frames: a known value replaces an unknown one, and a
    // value the sim later corrects replaces the old one.
    const patch: SessionPatch = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      const value = next[key];
      if (value !== null && value !== undefined && value !== s.meta[key]) {
        Object.assign(patch, { [key]: value });
        Object.assign(s.meta, { [key]: value });
      }
    }
    if (Object.keys(patch).length > 0) {
      this.enqueue((now) => this.store.updateSession(s.id, patch, now));
    }
  }

  private trackLaps(s: ActiveSession, frame: RecorderFrame): void {
    const records = frame.fuelLaps;
    // The tracker clears its list on a counter reset inside a session; start over with it.
    if (records.length < s.fuelCursor) s.fuelCursor = 0;
    for (let i = s.fuelCursor; i < records.length; i++) {
      this.closeLap(s, records[i] as FuelLapRecord, frame.state);
    }
    s.fuelCursor = records.length;
  }

  private closeLap(s: ActiveSession, record: FuelLapRecord, state: SimState): void {
    // A reset (tow, jump to the pits) cuts the lap short; the tracker keeps such records for
    // its own reasons, they are not laps.
    const crossed = record.reason !== "reset" && record.reason !== "skipped";
    const summary = s.laps.close(state, crossed);
    if (record.reason === "reset") return;
    const row: NewLap = {
      id: this.newId(this.now()),
      session_id: s.id,
      lap_index: 0,
      lap_number: record.lapNumber,
      lap_time_s: null,
      sector_times_json: null,
      fuel_valid: record.valid,
      fuel_invalid_reason: record.reason,
      fuel_used_l: record.usedL,
      fuel_start_l: summary.fuelStartL,
      fuel_end_l: summary.fuelEndL,
      energy_used: summary.energyUsed,
      position_end: summary.positionEnd,
      incidents_delta: summary.incidentsDelta,
      pit_lap: summary.pitLap,
      track_temp_c: summary.trackTempC,
      tyre_wear_delta: summary.tyreWearDelta,
      started_session_s: summary.startedAtS,
      ended_session_s: summary.endedAtS,
    };
    const tick = state.tickTimeS;
    const pending: PendingLap = {
      row,
      summary,
      baseline: s.lastLastLapS,
      deadlineS: crossed && tick !== null ? tick + LAP_TIME_WAIT_S : null,
    };
    s.pending.push(pending);
  }

  /** The sim reports a lap's time a moment after the line; wait briefly, then use our own. */
  private resolvePending(s: ActiveSession, state: SimState): void {
    if (s.pending.length === 0) return;
    const tick = state.tickTimeS;
    const nowLast = playerCar(state)?.lastLapS ?? null;
    let taken = false;
    const waiting: PendingLap[] = [];
    for (const p of s.pending) {
      if (!taken && p.deadlineS !== null && lastLapMoved(p.baseline, nowLast)) {
        // One change of the sim's last-lap time belongs to one lap.
        taken = true;
        this.finishLap(s, p, nowLast);
      } else if (p.deadlineS === null || (tick !== null && tick >= p.deadlineS)) {
        this.finishLap(s, p, p.summary.crossingTimeS);
      } else {
        if (taken) p.baseline = nowLast;
        waiting.push(p);
      }
    }
    s.pending = waiting;
  }

  private finishLap(s: ActiveSession, p: PendingLap, lapTimeS: number | null): void {
    s.lapIndex++;
    const row = { ...p.row, lap_index: s.lapIndex, lap_time_s: lapTimeS };
    s.rowsWritten++;
    this.enqueue((now) => this.store.insertLap(row, now));
  }

  private trackIncidents(s: ActiveSession, state: SimState): void {
    const event = s.incidents.update(state);
    if (event === null) return;
    s.rowsWritten++;
    const row = {
      id: this.newId(this.now()),
      session_id: s.id,
      lap: event.lap,
      time_s: event.timeS,
      count_delta: event.countDelta,
    };
    this.enqueue((now) => this.store.insertIncident(row, now));
  }

  private trackPits(s: ActiveSession, state: SimState): void {
    const stop = s.pits.update(state);
    if (stop === null) return;
    s.rowsWritten++;
    const stopRow = {
      id: this.newId(this.now()),
      session_id: s.id,
      lap: stop.lap,
      entry_time_s: stop.entryTimeS,
      exit_time_s: stop.exitTimeS,
      stationary_s: stop.stationaryS,
      fuel_added_l: stop.fuelAddedL,
    };
    this.enqueue((now) => this.store.insertPitStop(stopRow, now));
    const change = s.stints.onPitStop(stop);
    if (change === null) return;
    const ended = s.stintId;
    s.stintId = this.newId(this.now());
    s.stintNumber++;
    const next = {
      id: s.stintId,
      session_id: s.id,
      stint_number: s.stintNumber,
      start_lap: change.next.startLap,
      fuel_added_at_start_l: change.next.fuelAddedAtStartL,
    };
    this.enqueue((now) => {
      this.store.endStint(ended, change.endedAtLap, now);
      this.store.insertStint(next, now);
    });
  }

  // ---- Closing and flushing -----------------------------------------------------------------

  private finish(reason: EndReason, endedAt: number = this.now()): void {
    const s = this.active;
    if (s === null) return;
    this.active = null;
    // Laps still waiting for the sim's time get ours.
    for (const p of s.pending) this.finishLap(s, p, p.summary.crossingTimeS);
    s.pending = [];

    const elapsedS = (s.lastTickS ?? 0) - (s.firstTickS ?? 0);
    const useful =
      s.rowsWritten > 0 || elapsedS >= (this.options.minSessionS ?? MIN_USEFUL_SESSION_S);
    this.closeTier2(s, useful);
    if (!useful) {
      this.enqueue(() => this.store.deleteSession(s.id));
    } else {
      const endedStint = s.stintId;
      const lap = s.maxLap;
      const patch = this.finalPatch(s, reason, endedAt);
      this.enqueue((now) => {
        this.store.endStint(endedStint, lap, now);
        this.store.updateSession(s.id, patch, now);
      });
    }
    this.flushNow();
    if (useful) this.refreshManifest(s);
  }

  private finalPatch(s: ActiveSession, reason: EndReason, endedAt: number): SessionPatch {
    return {
      ended_at: endedAt,
      end_reason: reason,
      air_temp_c: s.air.value,
      track_temp_c: s.track.value,
      wetness_max: s.wetnessMax,
    };
  }

  private closeTier2(s: ActiveSession, keep: boolean): void {
    const files = s.tier2;
    if (files === null) return;
    s.tier2 = null;
    try {
      if (keep) files.writer.close();
    } catch (error) {
      this.options.log?.(`recorder: telemetry file not finished: ${String(error)}`);
    } finally {
      files.sink.close();
    }
    const dir = this.options.telemetryDir;
    if (!keep && dir !== null && s.tier2Path !== null) {
      rmSync(join(dir, ...s.tier2Path.split("/")), { force: true });
    }
  }

  private refreshManifest(s: ActiveSession): void {
    const dir = this.options.telemetryDir;
    if (dir === null || s.tier2Path === null) return;
    try {
      writeManifest(join(dir, ...s.tier2Path.split("/").slice(0, -1)), this.now());
    } catch (error) {
      this.options.log?.(`recorder: manifest not written: ${String(error)}`);
    }
  }

  private enqueue(op: (nowMs: number) => void): void {
    this.queue.push(op);
  }

  /**
   * Writes the queued rows in one transaction. The queue is only emptied once the transaction
   * committed: after a failure the same rows are tried again by the next flush, so a session row
   * is never lost to a passing error. Returns false when there was nothing to write.
   */
  private flushNow(): boolean {
    const s = this.active;
    this.flushTier2(s);
    const queued = this.queue.length;
    if (queued > MAX_QUEUED_OPS) {
      this.queue = [];
      this.disabled = true;
      this.options.log?.("recorder: database not writable, recording stopped until restart");
      return true;
    }
    if (queued === 0 && s === null) return false;
    const ops = [...this.queue];
    if (s !== null) {
      const patch: SessionPatch = {
        air_temp_c: s.air.value,
        track_temp_c: s.track.value,
        wetness_max: s.wetnessMax,
      };
      ops.push((now) => this.store.updateSession(s.id, patch, now));
    }
    const now = this.now();
    this.store.transaction(() => {
      for (const op of ops) op(now);
    });
    this.queue.splice(0, queued);
    return true;
  }

  private flushTier2(s: ActiveSession | null): void {
    if (!s?.tier2) return;
    try {
      const due = this.now() - s.tier2.flushedAt >= (this.options.partialChunkMs ?? 10_000);
      s.tier2.writer.flush(due);
      if (due) s.tier2.flushedAt = this.now();
    } catch (error) {
      this.dropTier2(s, error);
    }
  }
}

/** The session facts a state can give; unknown ones are null. No driver names. */
function sessionMeta(state: SimState): Omit<SessionPatch, "sim"> {
  const car = playerCar(state);
  const s = state.session;
  return {
    track_name: s.trackName,
    track_length_m: s.trackLengthM,
    car_name: car?.carName ?? null,
    car_class: car?.className ?? null,
    car_number: car?.carNumber ?? null,
    session_type: s.type,
    timing: s.timing,
    total_laps: s.lapsTotal,
    total_time_s: s.timeTotalS,
  };
}
