import type { StandingsEntry, TelemetryFrame } from "@overlay/sim-core/types";
import { fixtureFrame } from "../shared/fixtures";

type Entry = Partial<StandingsEntry> & { carIdx: number };

/**
 * Class A: car 1 (P1), car 2 (P2), the player car 3 (P3), car 4 (P4); car 5 is class B and P4 of
 * its class (overall between the player and car 4). Invented names.
 */
export function battleFrame(
  opts: {
    type?: "race" | "practice";
    sim?: "iracing" | "lmu";
    standings?: (entries: Entry[]) => Entry[];
  } = {},
): TelemetryFrame {
  const car = (carIdx: number, classId: string, name: string, lastLapS: number) => ({
    carIdx,
    classId,
    classColour: classId === "A" ? "#ffda59" : "#ff5888",
    carNumber: String(carIdx * 11),
    driverName: name,
    lastLapS,
    bestLapS: lastLapS - 0.3,
    iRating: 2000 + carIdx * 100,
    license: "A 3.00",
  });
  const entries: Entry[] = [
    { carIdx: 1, liveClassPosition: 1, classPosition: 1, sectorTimes: [30.1, 35.2, 34.9] },
    {
      carIdx: 2,
      liveClassPosition: 2,
      classPosition: 2,
      lineInterval: { laps: 0, seconds: 4.1 },
      interval: { laps: 0, seconds: 0.6 },
      sectorTimes: [30.24, 35.04, 34.97],
    },
    {
      carIdx: 3,
      liveClassPosition: 3,
      classPosition: 3,
      lineInterval: { laps: 0, seconds: 2.46 },
      interval: { laps: 0, seconds: 0.35 },
      sectorTimes: [30.1, 35.1, 34.9],
    },
    {
      carIdx: 5,
      liveClassPosition: 4,
      classPosition: 4,
      lineInterval: { laps: 0, seconds: 0.1 },
      sectorTimes: [25, 30, 29],
    },
    {
      carIdx: 4,
      liveClassPosition: 4,
      classPosition: 4,
      lineInterval: { laps: 0, seconds: 0.84 },
      interval: { laps: 0, seconds: 0.2 },
      sectorTimes: [30.29, null, 35.0],
    },
  ];
  return fixtureFrame({
    sim: opts.sim ?? "iracing",
    playerCarIdx: 3,
    session: { type: opts.type ?? "race", sectorStartPcts: [0, 0.3, 0.65] },
    cars: [
      car(1, "A", "Ann Leader", 99.8),
      car(2, "A", "Mira Castellan", 100.15),
      car(3, "A", "Alex Marlow", 100.0),
      car(5, "B", "Di Other", 88.2),
      car(4, "A", "Dario Okonkwo", 100.4),
    ],
    standings: opts.standings ? opts.standings(entries) : entries,
  });
}
