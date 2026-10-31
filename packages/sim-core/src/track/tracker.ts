import type { Car, SimState } from "../model";
import { TrackOutlineBuilder, FULL_COVERAGE_GAP, MAX_LENGTH_ERROR } from "./builder";
import { isTrackOutline } from "./outline";
import { trackKeyOf } from "./track-key";
import type { LapResult, TrackOutline, TrackOutlineStore, TrackSample } from "./types";

export interface DerivedTrack {
  /** Null until the sim and the track name are known. */
  trackKey: string | null;
  /** True when an outline for `trackKey` can be fetched. */
  outlineReady: boolean;
}

export function emptyDerivedTrack(): DerivedTrack {
  return { trackKey: null, outlineReady: false };
}

export interface TrackTrackerOptions {
  store?: TrackOutlineStore;
  now?: () => Date;
}

/**
 * Keeps the outline of the track the player is on: loads a stored one, otherwise builds one from
 * the player's clean laps and hands it to the store. See {@link isBetter} for what replaces it.
 */
export class TrackTracker {
  private key: string | null = null;
  private outline: TrackOutline | null = null;
  private builder: TrackOutlineBuilder | null = null;
  /** Best lap seen on this track in this run, for the 107% rule on the first timed lap. */
  private bestLapS: number | null = null;
  /** The outcome of the latest finished lap, for diagnostics and tests. */
  lastLap: LapResult | null = null;

  constructor(private readonly options: TrackTrackerOptions = {}) {}

  /** The outline for the current track, if there is one. */
  get current(): TrackOutline | null {
    return this.outline;
  }

  /** The key of the track being driven, when known. */
  get trackKey(): string | null {
    return this.key;
  }

  /** Forget the lap in progress (not the outline), e.g. after a session change. */
  reset(): void {
    this.builder?.reset();
  }

  update(state: SimState, player: Car | null): DerivedTrack {
    const key = trackKeyOf(state);
    if (key !== this.key) this.switchTrack(key, state);
    if (key !== null && this.wantsBuild()) this.feed(key, state, player);
    // Ticks that are skipped would leave a lap with a hole in it, so the next one starts afresh.
    else this.builder?.reset();
    return { trackKey: key, outlineReady: this.outline !== null };
  }

  private switchTrack(key: string | null, state: SimState): void {
    this.key = key;
    this.builder = null;
    this.bestLapS = null;
    this.lastLap = null;
    this.outline = key === null ? null : this.loadStored(key, state.session.trackLengthM);
  }

  private loadStored(key: string, trackLengthM: number | null): TrackOutline | null {
    const stored = this.options.store?.load(key) ?? null;
    if (stored === null || !isTrackOutline(stored) || stored.trackKey !== key) return null;
    // The same name can hide another layout: a stored outline of the wrong length is not used.
    const wrong =
      trackLengthM !== null &&
      Math.abs(stored.lengthM - trackLengthM) > MAX_LENGTH_ERROR * trackLengthM;
    return wrong ? null : stored;
  }

  /** Only a world-position outline that covers the whole lap is final. */
  private wantsBuild(): boolean {
    const have = this.outline;
    return have === null || have.source === "integrated" || have.gapPct > FULL_COVERAGE_GAP;
  }

  private feed(key: string, state: SimState, player: Car | null): void {
    const read = toSample(state, player);
    if (read === null) return;
    if (read.bestLapS !== null) {
      this.bestLapS = Math.min(this.bestLapS ?? Infinity, read.bestLapS);
    }
    const sample = { ...read, bestLapS: this.bestLapS };
    this.builder ??= new TrackOutlineBuilder({
      trackKey: key,
      trackLengthM: state.session.trackLengthM,
      ...(this.options.now ? { now: this.options.now } : {}),
    });
    const result = this.builder.push(sample);
    if (result === null) return;
    this.lastLap = result;
    if (result.ok && isBetter(this.outline, result.outline)) {
      this.outline = result.outline;
      this.options.store?.save(result.outline);
    }
  }
}

/** An integrated outline must miss its start by at most half as much to replace another one. */
const BETTER_CLOSURE_FACTOR = 0.5;
const BETTER_CLOSURE_MIN_GAIN_M = 1;

/** A world outline must have a gap this much smaller to replace another one. */
const BETTER_GAP = 0.005;

/**
 * A world-position outline replaces an integrated one, and replaces a world one that bridged a
 * pit exit when its own gap is clearly smaller; a full-coverage world outline is final. An
 * integrated one replaces another integrated one only when it closed clearly better (laps differ
 * by a few metres of drift, so equal ones do not churn the file).
 */
function isBetter(existing: TrackOutline | null, incoming: TrackOutline): boolean {
  if (existing === null) return true;
  if (existing.source === "world") {
    return incoming.source === "world" && incoming.gapPct < existing.gapPct - BETTER_GAP;
  }
  if (incoming.source === "world") return true;
  const gain = existing.closureErrorM - incoming.closureErrorM;
  return (
    incoming.closureErrorM < existing.closureErrorM * BETTER_CLOSURE_FACTOR &&
    gain >= BETTER_CLOSURE_MIN_GAIN_M
  );
}

export function toSample(state: SimState, player: Car | null): TrackSample | null {
  const pct = player?.lapDistPct ?? null;
  if (player === null || pct === null || state.tickTimeS === null) return null;
  const p = state.player;
  return {
    tickS: state.tickTimeS,
    lapDistPct: pct,
    onPitRoad: player.onPitRoad === true,
    onTrack: player.isOnTrack !== false,
    incidentCount: p.incidentCount,
    bestLapS: player.bestLapS,
    headingRad: p.yawRad,
    velocityMps: p.velocityMps === null ? null : { x: p.velocityMps.x, y: p.velocityMps.y },
    worldPos: p.worldPos === null ? null : { x: p.worldPos.x, z: p.worldPos.z },
  };
}
