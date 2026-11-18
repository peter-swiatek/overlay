import type { Car, SimState } from "../../model";
import { trackKeyOf } from "../../track/track-key";
import { carTrackKey } from "../fuel/history";
import type { LapHistory, LapRecord } from "../laps/types";
import { addSetupLap, emptySetupCombo, setupKeyOf, setupSide } from "./stats";
import type { SetupCombo, SetupCompare, SetupStatsStore } from "./types";

/**
 * A lap joins the setup statistics this long (session seconds) after it entered the lap history,
 * or as soon as a newer lap follows it: the fuel use and a late last sector time arrive in the
 * meantime.
 */
export const SETUP_LAP_SETTLE_S = 5;
/** Finished laps whose setup and top speed are kept until the lap history settles them. */
const FINISHED_KEPT = 5;

export interface SetupCompareOptions {
  /** Where setup statistics are kept between runs; without it they live only in memory. */
  store?: SetupStatsStore | null;
  /** Clock for the stored timestamps. */
  now?: () => Date;
}

/**
 * Key of one car at one track: `${sim}|${carSlug}|${trackKey}`, as the fuel history keys it; the
 * mock source uses "mock" for the sim. Null while the car or the track is unknown.
 */
export function setupComboKey(state: SimState, player: Car | null): string | null {
  if (player === null) return null;
  const trackKey = trackKeyOf(state);
  if (state.sim !== null) {
    return carTrackKey(state.sim, player.carName, trackKey, player.className);
  }
  if (state.source !== "mock" || trackKey === null || player.carName === null) return null;
  return `mock|${player.carName}|${trackKey}`;
}

interface FinishedLap {
  /** The setup loaded for the whole lap; null when it changed or was unknown at some point. */
  setup: string | null;
  topSpeedMps: number | null;
}

/**
 * Lap statistics per car setup, kept per car and track: best lap, the average of the last valid
 * laps, the best sector times, the top speed and the fuel use. Only valid laps count (the lap
 * history's rule: timed, watched from the line, clean, never on pit road), and only when one
 * setup was loaded for the whole lap.
 *
 * The baseline is the first setup that completed a valid lap this session, or, while the pin
 * option is on, the setup pinned for this car and track. Turning the option on pins the setup
 * loaded at that moment; a car and track without a pin pins its first setup with a valid lap.
 * Statistics and pins are written to the store only for live sims, never for the mock or a
 * replay. Stateful, free of timers.
 */
export class SetupCompareTracker {
  private readonly store: SetupStatsStore | null;
  private readonly now: () => Date;
  /** Combos of sources that are not stored (mock, replay), for this run only. */
  private readonly memory = new Map<string, SetupCombo>();

  private comboKey: string | null = null;
  private combo: SetupCombo = emptySetupCombo();
  private persist = false;
  /** First setup with a valid lap this session at this car and track. */
  private sessionFirst: string | null = null;
  /** The pin option; null until it is first set (a restart must not pin again). */
  private pinOn: boolean | null = null;
  private pinRequested = false;

  // The lap in progress.
  private lapCount: number | null = null;
  private lapSetup: string | null = null;
  private lapTopMps: number | null = null;
  private readonly finished = new Map<number, FinishedLap>();

  // Laps handed over from the lap history.
  private lastCommitted: number | null = null;
  private readonly seenAtS = new Map<number, number>();

  private active: string | null = null;
  private output: SetupCompare | null = null;
  private dirty = true;

  constructor(options: SetupCompareOptions = {}) {
    this.store = options.store ?? null;
    this.now = options.now ?? (() => new Date());
  }

  /** A new session: the session's first setup and the laps in hand are forgotten; pins stay. */
  reset(): void {
    this.comboKey = null;
    this.combo = emptySetupCombo();
    this.sessionFirst = null;
    this.lapCount = null;
    this.lapSetup = null;
    this.lapTopMps = null;
    this.finished.clear();
    this.lastCommitted = null;
    this.seenAtS.clear();
    this.active = null;
    this.output = null;
    this.dirty = true;
  }

  /**
   * The pin option. Turning it on (after it was known to be off) pins the setup loaded now, or the
   * next one seen when none is loaded.
   */
  setPinBaseline(on: boolean): void {
    if (on && this.pinOn === false) this.pinRequested = true;
    if (!on) this.pinRequested = false;
    if (this.pinOn !== on) this.dirty = true;
    this.pinOn = on;
  }

  next(state: SimState, laps: LapHistory | null): SetupCompare | null {
    const player =
      state.playerCarIdx === null
        ? null
        : (state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null);
    const active = setupKeyOf(state.player.setup);
    const key = setupComboKey(state, player);
    if (key !== this.comboKey) this.switchCombo(key, state);
    this.followLap(state, player, active);
    if (state.tickTimeS !== null && laps !== null && laps.carIdx === state.playerCarIdx) {
      this.takeLaps(laps.laps, state.tickTimeS);
    }
    if (this.pinRequested && active !== null && this.comboKey !== null) {
      this.pinRequested = false;
      this.change({ ...this.combo, baseline: active, updatedAt: this.now().toISOString() });
    }
    if (active !== this.active) {
      this.active = active;
      this.dirty = true;
    }
    return this.publish();
  }

  private switchCombo(key: string | null, state: SimState): void {
    this.comboKey = key;
    this.persist = state.source !== "replay" && state.source !== "mock";
    this.sessionFirst = null;
    this.dirty = true;
    if (key === null) {
      this.combo = emptySetupCombo();
      return;
    }
    const stored = this.persist ? (this.store?.load(key) ?? null) : null;
    this.combo = stored ?? this.memory.get(key) ?? emptySetupCombo();
  }

  private change(combo: SetupCombo): void {
    this.combo = combo;
    this.dirty = true;
    const key = this.comboKey;
    if (key === null) return;
    if (this.persist && this.store !== null) this.store.save(key, combo);
    else this.memory.set(key, combo);
  }

  /** The setup and the top speed of the lap in progress; both are kept per lap at the line. */
  private followLap(state: SimState, player: Car | null, active: string | null): void {
    const done = player?.lapsCompleted ?? null;
    if (done === null) {
      this.lapCount = null;
      return;
    }
    if (done !== this.lapCount) {
      if (this.lapCount !== null && done < this.lapCount) this.finished.clear();
      if (this.lapCount !== null && done === this.lapCount + 1) {
        this.finished.set(done, { setup: this.lapSetup, topSpeedMps: this.lapTopMps });
        this.finished.delete(done - FINISHED_KEPT);
      }
      this.lapCount = done;
      this.lapSetup = active;
      this.lapTopMps = null;
    } else if (active !== this.lapSetup) {
      // A setup change during the lap: the lap belongs to neither setup.
      this.lapSetup = null;
    }
    const speed = state.player.speedMps;
    if (speed !== null && Number.isFinite(speed) && speed > (this.lapTopMps ?? -1)) {
      this.lapTopMps = speed;
    }
  }

  /** Hands settled laps (oldest first) to the statistics; `laps` is newest first. */
  private takeLaps(laps: readonly LapRecord[], tickS: number): void {
    const newest = laps[0]?.lapNumber;
    if (newest === undefined) return;
    if (this.lastCommitted !== null && newest < this.lastCommitted) {
      // The lap history started over (a restarted replay).
      this.lastCommitted = null;
      this.seenAtS.clear();
    }
    for (let i = laps.length - 1; i >= 0; i--) {
      const lap = laps[i]!;
      if (this.lastCommitted !== null && lap.lapNumber <= this.lastCommitted) continue;
      let seen = this.seenAtS.get(lap.lapNumber);
      if (seen === undefined) {
        seen = tickS;
        this.seenAtS.set(lap.lapNumber, seen);
      }
      if (i === 0 && tickS - seen < SETUP_LAP_SETTLE_S) break;
      this.seenAtS.delete(lap.lapNumber);
      this.lastCommitted = lap.lapNumber;
      this.count(lap);
    }
  }

  private count(lap: LapRecord): void {
    const finished = this.finished.get(lap.lapNumber);
    const setup = finished?.setup ?? null;
    if (!lap.valid || lap.pit || lap.lapTimeS === null || setup === null) return;
    if (this.comboKey === null) return;
    const nowIso = this.now().toISOString();
    let combo = addSetupLap(
      this.combo,
      setup,
      {
        lapTimeS: lap.lapTimeS,
        sectorTimes: lap.sectorTimes,
        topSpeedMps: finished?.topSpeedMps ?? null,
        fuelUsedL: lap.fuelUsedL,
      },
      nowIso,
    );
    if (this.pinOn === true && combo.baseline === null) combo = { ...combo, baseline: setup };
    this.sessionFirst ??= setup;
    this.change(combo);
  }

  private publish(): SetupCompare | null {
    const active = this.active;
    if (this.comboKey === null || active === null) return null;
    if (!this.dirty && this.output !== null) return this.output;
    const pinnedKey = this.pinOn === true ? this.combo.baseline : null;
    const baseKey = pinnedKey ?? this.sessionFirst ?? active;
    this.output = {
      baseline: setupSide(baseKey, this.combo.setups[baseKey]),
      active: setupSide(active, this.combo.setups[active]),
      pinned: pinnedKey !== null,
    };
    this.dirty = false;
    return this.output;
  }
}
