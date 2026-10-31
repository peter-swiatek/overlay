import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { driverColumns } from "./columns";
import { FIXTURE_NAMES, fixtureFrame } from "./fixtures";
import { driverRows } from "./rows";

describe("driver kit timing", () => {
  it("builds and renders 60 rows well inside the budget", () => {
    const ids = Array.from({ length: 60 }, (_, i) => i);
    const frame = fixtureFrame({
      playerCarIdx: 5,
      cars: ids.map((i) => ({
        carIdx: i,
        driverName: FIXTURE_NAMES[i % FIXTURE_NAMES.length] ?? null,
        carNumber: String(i + 1),
        position: i + 1,
        classPosition: i + 1,
        lastLapS: 90 + i / 10,
        bestLapS: 89 + i / 10,
        license: "A 3.41",
        iRating: 2000 + i,
        classColour: "#ffda59",
      })),
      standings: ids.map((i) => ({
        carIdx: i,
        gapToClassLeader: { laps: 0, seconds: i * 1.3 },
        interval: { laps: 0, seconds: 1.3 },
      })),
      gaps: ids.map((i) => ({ carIdx: i, gapS: i - 5, tier: "position" as const })),
    });
    const columns = driverColumns({
      prefs: DEFAULT_DISPLAY_PREFS,
      nameDisplay: "driver",
      nameFormat: "f-last",
      gapDecimals: 1,
      lapDecimals: 3,
      combinedLicencePill: false,
      gapMode: "standings",
    });
    const run = (): number => {
      const start = performance.now();
      const rows = driverRows(frame, { livePositions: true, gapDecimals: 1, lapDecimals: 3 });
      for (const row of rows) {
        for (const c of columns) renderToStaticMarkup(<>{c.render(row)}</>);
      }
      return performance.now() - start;
    };
    run();
    const samples = Array.from({ length: 9 }, run).sort((a, b) => a - b);
    const median = samples[4] ?? 0;
    console.log(`driverRows + 60 x ${columns.length} cells: median ${median.toFixed(2)} ms`);
    // The rows alone are far cheaper; this renders every cell of every column through React.
    expect(median).toBeLessThan(500);
  });

  it("builds 60 rows in about a millisecond", () => {
    const frame = fixtureFrame({
      cars: Array.from({ length: 60 }, (_, i) => ({ carIdx: i, position: i + 1 })),
      standings: Array.from({ length: 60 }, (_, i) => ({ carIdx: i })),
    });
    const run = (): number => {
      const start = performance.now();
      driverRows(frame, { livePositions: true, gapDecimals: 1, lapDecimals: 3 });
      return performance.now() - start;
    };
    run();
    const samples = Array.from({ length: 21 }, run).sort((a, b) => a - b);
    const median = samples[10] ?? 0;
    console.log(`driverRows 60 cars: median ${median.toFixed(3)} ms`);
    expect(median).toBeLessThan(10);
  });
});
