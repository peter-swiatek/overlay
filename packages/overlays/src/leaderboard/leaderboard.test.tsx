import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayInstanceSettings } from "../contract";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings, sanitizeOptionValue } from "../settings";
import { DRIVER_FIELDS, FIXTURE_NAMES, driverRows, fixtureFrame, type DriverRow } from "../shared";
import { LeaderboardOverlay } from "./LeaderboardOverlay";
import { leaderboardManifest } from "./manifest";
import {
  leaderboardView,
  pickRows,
  reuseView,
  type DriversAround,
  type LeaderboardViewOptions,
} from "./view";

const OPTS: LeaderboardViewOptions = {
  showAll: true,
  around: 3,
  topMyClass: 3,
  topOtherClasses: 2,
  livePositions: false,
  gapDecimals: 1,
  lapDecimals: 3,
};

const CLASSES = [
  { id: "hy", name: "Hypercar", colour: "#ff3333" },
  { id: "p2", name: "LMP2", colour: "#3366ff" },
  { id: "gt", name: "GT3", colour: "#33cc66" },
] as const;

interface FieldCar {
  carIdx: number;
  classId: string;
  position: number | null;
  classPosition: number | null;
  livePosition?: number;
  liveClassPosition?: number;
}

/** Builds a frame from compact car specs; class info only when `multi`. */
function frameOf(cars: FieldCar[], player: number | null, multi = true): TelemetryFrame {
  const byId = new Map<string, (typeof CLASSES)[number]>(CLASSES.map((c) => [c.id, c]));
  return fixtureFrame({
    playerCarIdx: player,
    cars: cars.map((c) => {
      const cls = byId.get(c.classId);
      return {
        carIdx: c.carIdx,
        driverName: FIXTURE_NAMES[c.carIdx % FIXTURE_NAMES.length] ?? null,
        carNumber: String(c.carIdx + 1),
        classId: multi ? c.classId : null,
        className: multi ? (cls?.name ?? null) : null,
        classColour: multi ? (cls?.colour ?? null) : null,
        position: c.position,
        classPosition: c.classPosition,
        lapsCompleted: 3,
        lapDistPct: 0.5,
        lapInProgress: 4,
      };
    }),
    standings: cars.map((c) => ({
      carIdx: c.carIdx,
      position: c.position,
      classPosition: c.classPosition,
      livePosition: c.livePosition ?? c.position,
      liveClassPosition: c.liveClassPosition ?? c.classPosition,
      progressLaps: 3.5,
    })),
  });
}

/** 3 classes of 3 cars, interleaved overall: hy, p2, hy, gt, p2, gt, hy, ... */
function threeClasses(player: number | null = null): TelemetryFrame {
  const order: Array<[string, number]> = [
    ["hy", 1],
    ["p2", 1],
    ["hy", 2],
    ["gt", 1],
    ["p2", 2],
    ["gt", 2],
    ["hy", 3],
    ["p2", 3],
    ["gt", 3],
  ];
  return frameOf(
    order.map(([classId, classPosition], i) => ({
      carIdx: i,
      classId,
      position: i + 1,
      classPosition,
    })),
    player,
  );
}

function fakeRows(n: number, focus = -1): DriverRow[] {
  const frame = frameOf(
    Array.from({ length: n }, (_, i) => ({
      carIdx: i,
      classId: "hy",
      position: i + 1,
      classPosition: i + 1,
    })),
    focus >= 0 ? focus : null,
    false,
  );
  return driverRows(frame, OPTS);
}

const AROUND: DriversAround = { showAll: false, around: 2, topMyClass: 3, topOtherClasses: 2 };
const ids = (rows: readonly DriverRow[]): number[] => rows.map((r) => r.carIdx);

describe("leaderboardView", () => {
  it("makes one unlabelled, uncoloured section in a single-class session", () => {
    const frame = frameOf(
      [0, 1, 2].map((i) => ({ carIdx: i, classId: "x", position: 3 - i, classPosition: 3 - i })),
      1,
      false,
    );
    const view = leaderboardView(frame, OPTS);
    expect(view.multiClass).toBe(false);
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.label).toBe("");
    expect(view.sections[0]?.colour).toBeNull();
    expect(ids(view.sections[0]?.rows ?? [])).toEqual([2, 1, 0]);
  });

  it("orders classes by their leaders' overall positions and rows by class position", () => {
    const view = leaderboardView(threeClasses(), OPTS);
    expect(view.multiClass).toBe(true);
    expect(view.sections.map((s) => s.label)).toEqual(["Hypercar", "LMP2", "GT3"]);
    expect(ids(view.sections[0]?.rows ?? [])).toEqual([0, 2, 6]);
    expect(ids(view.sections[1]?.rows ?? [])).toEqual([1, 4, 7]);
    expect(view.sections.map((s) => s.total)).toEqual([3, 3, 3]);
  });

  it("orders classes by the faster leader even when listed later", () => {
    const frame = frameOf(
      [
        { carIdx: 0, classId: "gt", position: 2, classPosition: 1 },
        { carIdx: 1, classId: "hy", position: 1, classPosition: 1 },
      ],
      null,
    );
    expect(leaderboardView(frame, OPTS).sections.map((s) => s.key)).toEqual([
      "class:hy",
      "class:gt",
    ]);
  });

  it("passes class colours through unchanged", () => {
    const view = leaderboardView(threeClasses(), OPTS);
    expect(view.sections.map((s) => s.colour)).toEqual(["#ff3333", "#3366ff", "#33cc66"]);
  });

  it("uses live or official positions as asked", () => {
    const frame = frameOf(
      [
        {
          carIdx: 0,
          classId: "x",
          position: 1,
          classPosition: 1,
          livePosition: 2,
          liveClassPosition: 2,
        },
        {
          carIdx: 1,
          classId: "x",
          position: 2,
          classPosition: 2,
          livePosition: 1,
          liveClassPosition: 1,
        },
      ],
      null,
      false,
    );
    const official = leaderboardView(frame, { ...OPTS, livePositions: false });
    const live = leaderboardView(frame, { ...OPTS, livePositions: true });
    expect(ids(official.sections[0]?.rows ?? [])).toEqual([0, 1]);
    expect(ids(live.sections[0]?.rows ?? [])).toEqual([1, 0]);
  });

  it("puts cars without a position last, by progress and then carIdx", () => {
    const frame = fixtureFrame({
      cars: [
        { carIdx: 0, lapsCompleted: 1, lapDistPct: 0.1 },
        { carIdx: 1, position: 1, classPosition: 1 },
        { carIdx: 2, lapsCompleted: 5, lapDistPct: 0.1 },
        { carIdx: 3, lapsCompleted: 1, lapDistPct: 0.1 },
      ],
      standings: [{ carIdx: 0 }, { carIdx: 1 }, { carIdx: 2 }, { carIdx: 3 }],
    });
    const view = leaderboardView(frame, OPTS);
    expect(ids(view.sections[0]?.rows ?? [])).toEqual([1, 2, 0, 3]);
  });

  it("is empty without a frame", () => {
    expect(leaderboardView(null, OPTS).sections).toEqual([]);
  });

  it("applies Drivers around per class and lists rows after a gap", () => {
    // Player is Hypercar car 6 (class P3): top 1 + 1 around.
    const view = leaderboardView(threeClasses(6), {
      ...OPTS,
      showAll: false,
      topMyClass: 1,
      around: 0,
      topOtherClasses: 1,
    });
    expect(view.sections.map((s) => ids(s.rows))).toEqual([[0, 6], [1], [3]]);
    expect(view.afterGap).toEqual([6]);
    expect(view.sections.map((s) => s.total)).toEqual([3, 3, 3]);
  });

  it("drops classes that end up with no rows", () => {
    const view = leaderboardView(threeClasses(0), {
      ...OPTS,
      showAll: false,
      topOtherClasses: 0,
    });
    expect(view.sections.map((s) => s.label)).toEqual(["Hypercar"]);
  });

  it("shows the top of every class when nobody is the focus car", () => {
    const view = leaderboardView(threeClasses(null), { ...OPTS, showAll: false, topMyClass: 2 });
    expect(view.sections.map((s) => s.rows.length)).toEqual([2, 2, 2]);
  });

  it("keeps row identity for unchanged cars", () => {
    const first = leaderboardView(threeClasses(), OPTS);
    const again = reuseView(first, leaderboardView(threeClasses(), OPTS));
    expect(again.sections[0]?.rows[0]).toBe(first.sections[0]?.rows[0]);
  });
});

describe("pickRows", () => {
  it("shows everyone with showAll", () => {
    const rows = fakeRows(10, 4);
    expect(pickRows(rows, true, 4, { ...AROUND, showAll: true })).toHaveLength(10);
  });

  it("joins the top N, the cars around me and me, without duplicates", () => {
    const rows = fakeRows(20, 9);
    expect(ids(pickRows(rows, true, 9, AROUND))).toEqual([0, 1, 2, 7, 8, 9, 10, 11]);
    // Overlap between the top and the cars around me.
    const near = fakeRows(20, 4);
    expect(ids(pickRows(near, true, 4, AROUND))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("copes with the focus car in first and in last place", () => {
    const first = fakeRows(12, 0);
    expect(ids(pickRows(first, true, 0, AROUND))).toEqual([0, 1, 2]);
    const last = fakeRows(12, 11);
    expect(ids(pickRows(last, true, 11, AROUND))).toEqual([0, 1, 2, 9, 10, 11]);
  });

  it("shows the top K of other classes", () => {
    expect(ids(pickRows(fakeRows(8), false, -1, AROUND))).toEqual([0, 1]);
  });

  it("shows the top N of my class when there is no focus car", () => {
    expect(ids(pickRows(fakeRows(8), true, -1, AROUND))).toEqual([0, 1, 2]);
  });

  it("handles zero for N or M", () => {
    const rows = fakeRows(12, 6);
    expect(ids(pickRows(rows, true, 6, { ...AROUND, topMyClass: 0 }))).toEqual([4, 5, 6, 7, 8]);
    expect(ids(pickRows(rows, true, 6, { ...AROUND, around: 0 }))).toEqual([0, 1, 2, 6]);
    expect(ids(pickRows(rows, true, 6, { ...AROUND, around: 0, topMyClass: 0 }))).toEqual([6]);
    expect(pickRows(rows, false, -1, { ...AROUND, topOtherClasses: 0 })).toEqual([]);
  });
});

describe("afterGap", () => {
  it("lists only rows that follow skipped rows", () => {
    const view = leaderboardView(
      frameOf(
        Array.from({ length: 20 }, (_, i) => ({
          carIdx: i,
          classId: "x",
          position: i + 1,
          classPosition: i + 1,
        })),
        9,
        false,
      ),
      { ...OPTS, ...AROUND },
    );
    expect(ids(view.sections[0]?.rows ?? [])).toEqual([0, 1, 2, 7, 8, 9, 10, 11]);
    expect(view.afterGap).toEqual([7]);
  });

  it("is empty when nothing is skipped", () => {
    expect(leaderboardView(threeClasses(), OPTS).afterGap).toEqual([]);
  });
});

describe("manifest", () => {
  it("declares every driver field with the kit defaults", () => {
    expect(leaderboardManifest.fields).toBe(DRIVER_FIELDS);
    const visible = leaderboardManifest.fields.filter((f) => f.defaultVisible).map((f) => f.id);
    expect(visible).toEqual([
      "position",
      "car-number",
      "driver",
      "licence",
      "irating",
      "gap",
      "interval",
      "last-lap",
      "best-lap",
      "pit-lane",
    ]);
  });

  it("sanitises its defaults and limits the header fields to six", () => {
    const settings = defaultInstanceSettings(leaderboardManifest);
    expect(settings.options["around"]).toBe(3);
    expect(settings.options["top-other-classes"]).toBe(2);
    const field = leaderboardManifest.settings.find((s) => s.key === "header-fields");
    expect(field?.kind).toBe("multi");
    if (field === undefined) throw new Error("missing header-fields");
    const eight = [
      "sof",
      "incidents",
      "session-remaining",
      "sim-time",
      "real-time",
      "air-temp",
      "track-temp",
      "wetness",
    ];
    expect(sanitizeOptionValue(field, eight)).toEqual(eight.slice(0, 6));
  });
});

function render(
  frame: TelemetryFrame | null,
  patch: Parameters<typeof applySettingsPatch>[2] = {},
): string {
  const settings: OverlayInstanceSettings = applySettingsPatch(
    leaderboardManifest,
    defaultInstanceSettings(leaderboardManifest),
    patch,
  );
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(frame)}>
      <LeaderboardOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const ALL = { options: { "show-all": true } };

describe("LeaderboardOverlay", () => {
  it("draws a class bar per class in multi-class sessions", () => {
    const html = render(threeClasses(1), ALL);
    expect(html.match(/ov-section-bar/g)).toHaveLength(3);
    for (const name of ["Hypercar", "LMP2", "GT3"]) expect(html).toContain(name);
    expect(html).toContain("3 cars");
    expect(html).toContain("--ov-class-colour:#ff3333");
  });

  it("draws no class bar in a single-class session", () => {
    const frame = frameOf(
      [0, 1].map((i) => ({ carIdx: i, classId: "x", position: i + 1, classPosition: i + 1 })),
      0,
      false,
    );
    expect(render(frame, ALL)).not.toContain("ov-section-bar");
  });

  it("marks the own row", () => {
    const html = render(threeClasses(4), ALL);
    expect(html.match(/ov-row--own/g)).toHaveLength(1);
  });

  it("shows the session header only when switched on", () => {
    const frame = threeClasses(1);
    frame.state.conditions.trackTempC = 31;
    expect(render(frame, ALL)).toContain("ov-info-strip");
    expect(render(frame, { options: { "show-all": true, "session-header": false } })).not.toContain(
      "ov-info-strip",
    );
  });

  it("shows row labels only when switched on", () => {
    const frame = threeClasses(1);
    expect(render(frame, ALL)).toContain("ov-row--header");
    expect(render(frame, { options: { "show-all": true, "row-labels": false } })).not.toContain(
      "ov-row--header",
    );
  });

  it("shows lapped gaps as +1 L", () => {
    const frame = threeClasses(1);
    const entry = frame.derived.standings?.entries.find((e) => e.carIdx === 2);
    if (entry === undefined) throw new Error("fixture");
    entry.gapToClassLeader = { laps: 1, seconds: 4 };
    expect(render(frame, ALL)).toContain("+1 L");
  });

  it("passes the class colour to the car number cells", () => {
    const html = render(threeClasses(1), ALL);
    expect(html).toMatch(
      /--ov-class-colour:#33cc66[^>]*>(?:(?!<\/div><div class="ov-row)[\s\S])*ov-driver-number/,
    );
  });

  it("waits for standings when there are no rows", () => {
    expect(render(null)).toContain("Waiting for standings");
  });
});

describe("leaderboardView timing", () => {
  it("builds a 60-car three-class field well inside the budget", () => {
    const cars: FieldCar[] = Array.from({ length: 60 }, (_, i) => ({
      carIdx: i,
      classId: CLASSES[i % 3]?.id ?? "hy",
      position: i + 1,
      classPosition: Math.floor(i / 3) + 1,
    }));
    const frame = frameOf(cars, 30);
    const options = { ...OPTS, showAll: false };
    const run = (): number => {
      const start = performance.now();
      leaderboardView(frame, options);
      return performance.now() - start;
    };
    run();
    const samples = Array.from({ length: 21 }, run).sort((a, b) => a - b);
    const median = samples[10] ?? 0;
    console.log(`leaderboardView 60 cars, 3 classes: median ${median.toFixed(3)} ms`);
    expect(median).toBeLessThan(10);
  });
});
