import type { Flags, TelemetryFrame } from "@overlay/sim-core/types";

/*
 * Digi Flag view model: the one flag a digital marshalling panel shows the player. The flags
 * come from sim-core (`state.flags`, the player's own flags):
 * - iRacing: every flag below, from the session flag bits.
 * - LMU: green, local yellow and blue only; the shared memory shows no trigger for the others yet.
 */

export type FlagKind =
  | "red"
  | "disqualified"
  | "black"
  | "repair"
  | "furled"
  | "checkered"
  | "fullCourseYellow"
  | "yellow"
  | "blue"
  | "white"
  | "green";

/**
 * Highest first. Stop-the-session and car-specific orders (red, disqualified, black, repair) come
 * before everything; the conduct warning before the finish; a caution before a blue flag; the
 * last-lap white is informative only; green only marks a start or a cleared caution.
 */
export const FLAG_PRIORITY: readonly FlagKind[] = [
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
];

/** The highest-priority flag shown to the player; null when none (or the sim gives none). */
export function topFlag(flags: Flags | null): FlagKind | null {
  if (flags === null) return null;
  return FLAG_PRIORITY.find((kind) => flags[kind]) ?? null;
}

/** Flags that call for caution; green after one of them clears is a restart. */
const CAUTIONS: ReadonlySet<FlagKind> = new Set(["red", "fullCourseYellow", "yellow"]);

/** Remembers when the green flag came on (or a caution cleared under it). */
export interface GreenMemory {
  /** When the current green began, seconds on the caller's clock; null while there is none. */
  sinceS: number | null;
  /** The last top flag was a caution. */
  caution: boolean;
}

export function newGreenMemory(): GreenMemory {
  return { sinceS: null, caution: false };
}

/**
 * Steps the green memory and returns the flag to show: `top`, except that green shows only for
 * `holdS` seconds after it came on or after a caution cleared (start / restart), then the panel
 * goes dark. Some sims keep the green flag on all race, so a steady green is not shown.
 */
export function withGreenHold(
  memory: GreenMemory,
  flags: Flags | null,
  top: FlagKind | null,
  nowS: number,
  holdS: number,
): FlagKind | null {
  const caution = top !== null && CAUTIONS.has(top);
  if (flags?.green !== true) memory.sinceS = null;
  else if (memory.sinceS === null || nowS < memory.sinceS || (memory.caution && !caution)) {
    memory.sinceS = nowS;
  }
  memory.caution = caution;
  if (top !== "green") return top;
  return memory.sinceS !== null && nowS - memory.sinceS < holdS ? "green" : null;
}

/** LED colour of a state; matches a `.df--<tone>` rule in digi-flag.css. */
export type FlagTone = "red" | "yellow" | "blue" | "green" | "white" | "meatball";

interface FlagLook {
  caption: string;
  tone: FlagTone;
  pattern: LedPattern;
  /** May blink when the blink setting is on. */
  blinks: boolean;
}

export const LED_COLUMNS = 5;
export const LED_ROWS = 5;

type LedPattern = "full" | "checkered" | "frame" | "disc" | "diagonal";

const LOOKS: Readonly<Record<FlagKind, FlagLook>> = {
  red: { caption: "RED FLAG", tone: "red", pattern: "full", blinks: false },
  disqualified: {
    caption: "DISQUALIFIED",
    tone: "white",
    pattern: "frame",
    blinks: false,
  },
  black: { caption: "BLACK FLAG", tone: "white", pattern: "frame", blinks: false },
  repair: { caption: "REPAIR", tone: "meatball", pattern: "disc", blinks: false },
  furled: { caption: "WARNING", tone: "white", pattern: "diagonal", blinks: false },
  checkered: {
    caption: "FINISH",
    tone: "white",
    pattern: "checkered",
    blinks: false,
  },
  fullCourseYellow: {
    caption: "SAFETY CAR",
    tone: "yellow",
    pattern: "full",
    blinks: true,
  },
  yellow: { caption: "CAUTION", tone: "yellow", pattern: "full", blinks: true },
  blue: { caption: "BLUE FLAG", tone: "blue", pattern: "full", blinks: true },
  white: { caption: "LAST LAP", tone: "white", pattern: "full", blinks: false },
  green: { caption: "GREEN", tone: "green", pattern: "full", blinks: false },
};

/** Which LEDs of the 5 x 5 grid are lit, row by row from the top left. */
export function ledPattern(pattern: LedPattern): boolean[] {
  const leds: boolean[] = [];
  for (let row = 0; row < LED_ROWS; row++) {
    for (let col = 0; col < LED_COLUMNS; col++) {
      const edge = row === 0 || row === LED_ROWS - 1 || col === 0 || col === LED_COLUMNS - 1;
      const middle = col === 2 || row === 2;
      const inner = col >= 1 && col <= 3 && row >= 1 && row <= 3;
      switch (pattern) {
        case "full":
          leds.push(true);
          break;
        case "checkered":
          leds.push((row + col) % 2 === 0);
          break;
        case "frame":
          leds.push(edge);
          break;
        case "disc":
          leds.push(inner || middle);
          break;
        case "diagonal":
          // Upper-left half lit: the furled (diagonally split) flag.
          leds.push(col / (LED_COLUMNS - 1) + row / (LED_ROWS - 1) < 1);
          break;
      }
    }
  }
  return leds;
}

const DARK: readonly boolean[] = Array.from({ length: LED_COLUMNS * LED_ROWS }, () => false);

export interface DigiFlagView {
  flag: FlagKind | null;
  /** Under the grid, e.g. "CAUTION"; "" when no flag. */
  caption: string;
  /** Null when no flag (all LEDs dim). */
  tone: FlagTone | null;
  /** 25 LEDs, row by row. */
  leds: readonly boolean[];
  blink: boolean;
}

export interface DigiFlagOptions {
  /** Blink the LEDs for yellow, safety car and blue. */
  blink: boolean;
  /** Seconds green shows after a start or a cleared caution; 0 never shows it. */
  greenHoldS: number;
}

/** The view for `flag`. */
export function flagView(
  flag: FlagKind | null,
  options: Pick<DigiFlagOptions, "blink">,
): DigiFlagView {
  if (flag === null) {
    return { flag: null, caption: "", tone: null, leds: DARK, blink: false };
  }
  const look = LOOKS[flag];
  return {
    flag,
    caption: look.caption,
    tone: look.tone,
    leds: ledPattern(look.pattern),
    blink: options.blink && look.blinks,
  };
}

/** Null without a live frame; otherwise the panel, dark when no flag is shown. */
export function digiFlagView(
  frame: TelemetryFrame | null,
  memory: GreenMemory,
  nowS: number,
  options: DigiFlagOptions,
): DigiFlagView | null {
  if (frame === null || frame.status !== "live") return null;
  const flags = frame.state.flags;
  const flag = withGreenHold(memory, flags, topFlag(flags), nowS, options.greenHoldS);
  return flagView(flag, options);
}

/** The design's sample, shown in edit mode while no flag is out: a local yellow. */
export function sampleDigiFlagView(options: Pick<DigiFlagOptions, "blink">): DigiFlagView {
  return flagView("yellow", options);
}
