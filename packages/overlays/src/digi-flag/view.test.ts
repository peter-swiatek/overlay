import type { Flags } from "@overlay/sim-core/types";
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

function frame(flags: Partial<Flags> | null) {
  return fixtureFrame({ cars: [{ carIdx: 0 }], playerCarIdx: 0, flags });
}

/** "x" lit, "." dark, one row per string. */
function draw(leds: readonly boolean[]): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 5; r++) {
    rows.push(
      leds
        .slice(r * 5, r * 5 + 5)
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
  it("draws each pattern on the 5 x 5 grid", () => {
    expect(draw(ledPattern("full"))).toEqual(["xxxxx", "xxxxx", "xxxxx", "xxxxx", "xxxxx"]);
    expect(draw(ledPattern("checkered"))).toEqual(["x.x.x", ".x.x.", "x.x.x", ".x.x.", "x.x.x"]);
    expect(draw(ledPattern("frame"))).toEqual(["xxxxx", "x...x", "x...x", "x...x", "xxxxx"]);
    expect(draw(ledPattern("disc"))).toEqual(["..x..", ".xxx.", "xxxxx", ".xxx.", "..x.."]);
    expect(draw(ledPattern("diagonal"))).toEqual(["xxxx.", "xxx..", "xx...", "x....", "....."]);
  });
});

describe("flagView", () => {
  it("is dark with no flag", () => {
    const v = flagView(null, { blink: true });
    expect(v).toMatchObject({ flag: null, caption: "", tone: null, blink: false });
    expect(v.leds).toHaveLength(25);
    expect(v.leds.some(Boolean)).toBe(false);
  });

  it("names each flag with a caption and its colour", () => {
    const look = (k: FlagKind) => {
      const v = flagView(k, { blink: false });
      return [v.caption, v.tone];
    };
    expect(look("red")).toEqual(["RED FLAG", "red"]);
    expect(look("disqualified")).toEqual(["DISQUALIFIED", "white"]);
    expect(look("black")).toEqual(["BLACK FLAG", "white"]);
    expect(look("repair")).toEqual(["REPAIR", "meatball"]);
    expect(look("furled")).toEqual(["WARNING", "white"]);
    expect(look("checkered")).toEqual(["FINISH", "white"]);
    expect(look("fullCourseYellow")).toEqual(["SAFETY CAR", "yellow"]);
    expect(look("yellow")).toEqual(["CAUTION", "yellow"]);
    expect(look("blue")).toEqual(["BLUE FLAG", "blue"]);
    expect(look("white")).toEqual(["LAST LAP", "white"]);
    expect(look("green")).toEqual(["GREEN", "green"]);
  });

  it("blinks yellow, safety car and blue only when asked", () => {
    const blinks = (k: FlagKind, blink: boolean) => flagView(k, { blink }).blink;
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

  it("shows the player's top flag", () => {
    const v = digiFlagView(frame({ yellow: true, blue: true }), newGreenMemory(), 0, OPTIONS);
    expect(v).toMatchObject({ flag: "yellow", caption: "CAUTION" });
    expect(digiFlagView(frame({ blue: true }), newGreenMemory(), 0, OPTIONS)?.flag).toBe("blue");
  });

  it("holds green across frames with the same memory", () => {
    const m = newGreenMemory();
    expect(digiFlagView(frame({ green: true }), m, 10, OPTIONS)?.flag).toBe("green");
    expect(digiFlagView(frame({ green: true }), m, 16, OPTIONS)?.flag).toBeNull();
  });

  it("has the design's yellow sample for edit mode", () => {
    expect(sampleDigiFlagView({ blink: false })).toMatchObject({
      flag: "yellow",
      caption: "CAUTION",
      tone: "yellow",
      blink: false,
    });
    expect(sampleDigiFlagView({ blink: false }).leds.every(Boolean)).toBe(true);
  });
});
