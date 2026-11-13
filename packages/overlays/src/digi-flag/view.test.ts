import type { DeltaOutputs, Flags } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import {
  FLAG_PRIORITY,
  digiFlagView,
  flagView,
  ledPattern,
  newGreenMemory,
  sampleDigiFlagView,
  topFlag,
  withGreenHold,
  type DigiFlagOptions,
  type FlagKind,
} from "./view";

const OPTIONS: DigiFlagOptions = { blink: false, greenHoldS: 5 };

const NONE: Flags = {
  green: false,
  yellow: false,
  fullCourseYellow: false,
  red: false,
  blue: false,
  white: false,
  checkered: false,
  black: false,
  disqualified: false,
  repair: false,
  furled: false,
};

function only(...kinds: FlagKind[]): Flags {
  const f = { ...NONE };
  for (const k of kinds) f[k] = true;
  return f;
}

function frame(flags: Partial<Flags> | null, sector: number | null = null) {
  const f = fixtureFrame({ cars: [{ carIdx: 0 }], playerCarIdx: 0, flags });
  if (sector !== null) {
    f.derived.delta = { sectors: { current: sector } } as unknown as DeltaOutputs;
  }
  return f;
}

/** "x" lit, "." dark, one row per string. */
function draw(leds: readonly boolean[]): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    rows.push(
      leds
        .slice(r * 6, r * 6 + 6)
        .map((on) => (on ? "x" : "."))
        .join(""),
    );
  }
  return rows;
}

describe("topFlag", () => {
  it("is null without flags or with none out", () => {
    expect(topFlag(null)).toBeNull();
    expect(topFlag(NONE)).toBeNull();
  });

  it("covers every flag the sims give", () => {
    expect([...FLAG_PRIORITY].sort()).toEqual(Object.keys(NONE).sort());
  });

  it("picks the highest-priority flag", () => {
    expect(FLAG_PRIORITY).toEqual([
      "red",
      "disqualified",
      "black",
      "repair",
      "furled",
      "checkered",
      "fullCourseYellow",
      "yellow",
      "blue",
      "white",
      "green",
    ]);
    expect(topFlag(only("green", "yellow"))).toBe("yellow");
    expect(topFlag(only("yellow", "fullCourseYellow"))).toBe("fullCourseYellow");
    expect(topFlag(only("blue", "yellow"))).toBe("yellow");
    expect(topFlag(only("white", "blue"))).toBe("blue");
    expect(topFlag(only("checkered", "white", "yellow"))).toBe("checkered");
    expect(topFlag(only("red", "checkered"))).toBe("red");
    // iRacing sets the black bits with disqualify.
    expect(topFlag(only("black", "disqualified"))).toBe("disqualified");
    expect(topFlag(only("repair", "checkered"))).toBe("repair");
    expect(topFlag(only("furled", "blue"))).toBe("furled");
  });
});

describe("withGreenHold", () => {
  const step = (m: ReturnType<typeof newGreenMemory>, flags: Flags, t: number, holdS = 5) =>
    withGreenHold(m, flags, topFlag(flags), t, holdS);

  it("shows green for the hold after it comes on, then goes dark", () => {
    const m = newGreenMemory();
    expect(step(m, NONE, 0)).toBeNull();
    expect(step(m, only("green"), 1)).toBe("green");
    expect(step(m, only("green"), 5.9)).toBe("green");
    expect(step(m, only("green"), 6)).toBeNull();
    expect(step(m, only("green"), 100)).toBeNull();
  });

  it("shows green again when a caution clears under a steady green", () => {
    const m = newGreenMemory();
    step(m, only("green"), 0);
    expect(step(m, only("green"), 20)).toBeNull();
    expect(step(m, only("green", "yellow"), 21)).toBe("yellow");
    expect(step(m, only("green"), 30)).toBe("green");
    expect(step(m, only("green"), 36)).toBeNull();
  });

  it("does not restart green after a blue or white flag", () => {
    const m = newGreenMemory();
    step(m, only("green"), 0);
    expect(step(m, only("green", "blue"), 20)).toBe("blue");
    expect(step(m, only("green"), 25)).toBeNull();
    expect(step(m, only("green", "white"), 30)).toBe("white");
    expect(step(m, only("green"), 31)).toBeNull();
  });

  it("never shows green with a hold of 0, and restarts when the clock goes back", () => {
    const m = newGreenMemory();
    expect(step(m, only("green"), 0, 0)).toBeNull();
    const back = newGreenMemory();
    step(back, only("green"), 50);
    expect(step(back, only("green"), 60)).toBeNull();
    expect(step(back, only("green"), 10)).toBe("green");
  });
});

describe("ledPattern", () => {
  it("draws each pattern on the 6 x 4 grid", () => {
    expect(draw(ledPattern("full"))).toEqual(["xxxxxx", "xxxxxx", "xxxxxx", "xxxxxx"]);
    expect(draw(ledPattern("checkered"))).toEqual(["x.x.x.", ".x.x.x", "x.x.x.", ".x.x.x"]);
    expect(draw(ledPattern("frame"))).toEqual(["xxxxxx", "x....x", "x....x", "xxxxxx"]);
    expect(draw(ledPattern("disc"))).toEqual(["..xx..", ".xxxx.", ".xxxx.", "..xx.."]);
    expect(draw(ledPattern("diagonal"))).toEqual(["xxxxx.", "xxxx..", "xx....", "......"]);
  });
});

describe("flagView", () => {
  it("is dark with no flag", () => {
    const v = flagView(null, 2, { blink: true });
    expect(v).toMatchObject({ flag: null, code: "", caption: "", tone: null, blink: false });
    expect(v.leds).toHaveLength(24);
    expect(v.leds.some(Boolean)).toBe(false);
  });

  it("names each flag with a short code, a caption and its colour", () => {
    const look = (k: FlagKind) => {
      const v = flagView(k, null, { blink: false });
      return [v.code, v.caption, v.tone];
    };
    expect(look("red")).toEqual(["RED", "RED FLAG", "red"]);
    expect(look("disqualified")).toEqual(["DSQ", "DISQUALIFIED", "white"]);
    expect(look("black")).toEqual(["BLK", "BLACK FLAG", "white"]);
    expect(look("repair")).toEqual(["REP", "REPAIR", "meatball"]);
    expect(look("furled")).toEqual(["WARN", "WARNING", "white"]);
    expect(look("checkered")).toEqual(["CHK", "FINISH", "white"]);
    expect(look("fullCourseYellow")).toEqual(["SC", "SAFETY CAR", "yellow"]);
    expect(look("yellow")).toEqual(["YLW", "CAUTION", "yellow"]);
    expect(look("blue")).toEqual(["BLU", "BLUE FLAG", "blue"]);
    expect(look("white")).toEqual(["WHT", "LAST LAP", "white"]);
    expect(look("green")).toEqual(["GRN", "GREEN", "green"]);
  });

  it("adds the sector to a local yellow only", () => {
    expect(flagView("yellow", 2, { blink: false }).code).toBe("YLW S2");
    expect(flagView("fullCourseYellow", 2, { blink: false }).code).toBe("SC");
  });

  it("blinks yellow, safety car and blue only when asked", () => {
    const blinks = (k: FlagKind, blink: boolean) => flagView(k, null, { blink }).blink;
    expect(blinks("yellow", true)).toBe(true);
    expect(blinks("fullCourseYellow", true)).toBe(true);
    expect(blinks("blue", true)).toBe(true);
    expect(blinks("yellow", false)).toBe(false);
    expect(blinks("red", true)).toBe(false);
    expect(blinks("green", true)).toBe(false);
  });
});

describe("digiFlagView", () => {
  it("is null without a live frame", () => {
    expect(digiFlagView(null, newGreenMemory(), 0, OPTIONS)).toBeNull();
    const waiting = frame({ yellow: true });
    waiting.status = "waiting";
    expect(digiFlagView(waiting, newGreenMemory(), 0, OPTIONS)).toBeNull();
  });

  it("is dark when the sim gives no flags or none is out", () => {
    expect(digiFlagView(frame(null), newGreenMemory(), 0, OPTIONS)?.flag).toBeNull();
    expect(digiFlagView(frame({}), newGreenMemory(), 0, OPTIONS)?.flag).toBeNull();
  });

  it("shows the player's flag, with the player's sector on a local yellow", () => {
    const v = digiFlagView(frame({ yellow: true, blue: true }, 1), newGreenMemory(), 0, OPTIONS);
    expect(v).toMatchObject({ flag: "yellow", code: "YLW S2", caption: "CAUTION" });
    expect(digiFlagView(frame({ yellow: true }), newGreenMemory(), 0, OPTIONS)?.code).toBe("YLW");
    const blue = digiFlagView(frame({ blue: true }, 1), newGreenMemory(), 0, OPTIONS);
    expect(blue?.code).toBe("BLU");
  });

  it("holds green across frames with the same memory", () => {
    const m = newGreenMemory();
    expect(digiFlagView(frame({ green: true }), m, 10, OPTIONS)?.flag).toBe("green");
    expect(digiFlagView(frame({ green: true }), m, 16, OPTIONS)?.flag).toBeNull();
  });

  it("has the design's yellow S2 sample for edit mode", () => {
    expect(sampleDigiFlagView({ blink: false })).toMatchObject({
      flag: "yellow",
      code: "YLW S2",
      caption: "CAUTION",
      tone: "yellow",
      blink: false,
    });
    expect(sampleDigiFlagView({ blink: false }).leds.every(Boolean)).toBe(true);
  });
});
