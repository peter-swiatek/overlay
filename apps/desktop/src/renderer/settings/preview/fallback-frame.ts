import type { TelemetryFrame } from "@overlay/sim-core/types";
// Test-support code in the overlays package; it only has type imports, so no Node code reaches
// the renderer bundle.
import { FIXTURE_NAMES, fixtureFrame } from "@overlay/overlays/fixtures";

const COUNT = 8;

/**
 * A static grid of invented drivers: the first paint while the demo feed warms up, and the
 * stand-in until the feed has live frames.
 */
export function fallbackFrame(): TelemetryFrame {
  const ids = Array.from({ length: COUNT }, (_, i) => i);
  const frame = fixtureFrame({
    playerCarIdx: 3,
    cars: ids.map((i) => ({
      carIdx: i,
      driverName: FIXTURE_NAMES[i] ?? `Driver ${i + 1}`,
      carNumber: String(10 + i * 11),
      position: i + 1,
      classPosition: i + 1,
      lapsCompleted: 5,
      lapInProgress: 6,
      lapDistPct: 0.6 - i * 0.04,
      lastLapS: 92.4 + i * 0.35,
      bestLapS: 91.9 + i * 0.3,
      iRating: 4200 - i * 330,
      license: "A 3.41",
      isOnTrack: true,
    })),
    standings: ids.map((i) => ({
      carIdx: i,
      position: i + 1,
      classPosition: i + 1,
      livePosition: i + 1,
      liveClassPosition: i + 1,
      gapToLeader: i === 0 ? null : { laps: 0, seconds: i * 1.8 },
      interval: i === 0 ? null : { laps: 0, seconds: 1.8 },
      sessionBest: i === 0,
    })),
    gaps: ids
      .filter((i) => i !== 3)
      .map((i) => ({ carIdx: i, gapS: (3 - i) * 1.8, tier: "position" })),
    session: { timing: "time", timeRemainingS: 1500, trackName: "Demo Circuit" },
    conditions: { airTempC: 22, trackTempC: 31, wetness: 0 },
    player: { fuelL: 38, fuelCapacityL: 60, speedMps: 62, gear: 5 },
  });
  return {
    ...frame,
    derived: {
      ...frame.derived,
      fuel: {
        fuelLastLap: 2.5,
        fuelAvgLap: 2.5,
        fuelMaxLap: 3,
        lapsRemainingAvg: 15.2,
        lapsRemainingConservative: 12.7,
        fuelDelta: null,
        plusOneLapTarget: null,
        fuelSavingNeeded: null,
        pitWindow: { start: 14, end: 19, feasible: true },
        tankCapacityL: 60,
        validLapCount: 4,
        fuelAvg5Lap: 2.4,
        fuelAvg10Lap: 2.5,
        recentLaps: [
          { lapNumber: 5, used: 2.6, lapTimeS: 92 },
          { lapNumber: 4, used: 2.5, lapTimeS: 92 },
          { lapNumber: 3, used: 2.4, lapTimeS: 93 },
        ],
        lapsToGo: 15,
        stintLaps: 5,
        stintTimeS: 460,
        fuelPerHour: null,
      },
    },
  };
}
