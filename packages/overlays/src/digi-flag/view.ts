import type { Flags, TelemetryFrame } from "@overlay/sim-core/types";

/*
 * Digi Flag view model: the one flag a digital marshalling panel shows the player. The flags
 * come from sim-core (`state.flags`, the player's own flags):
 * - iRacing: every flag below, from the session flag bits.
 * - LMU: green, local yellow and blue only; the shared memory shows no trigger for the others yet.
 * The yellow's sector is the sector the player is in (from the delta tracker's sector timing), as
 * a local yellow applies where the player is; it is left out on tracks without sector data.
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
  /** Header code before any sector, e.g. "YLW". */
  code: string;
  caption: string;
  tone: FlagTone;
  pattern: LedPattern;
  /** May blink when the blink setting is on. */
  blinks: boolean;
}

export const LED_COLUMNS = 6;
export const LED_ROWS = 4;

type LedPattern = "full" | "checkered" | "frame" | "disc" | "diagonal";

const LOOKS: Readonly<Record<FlagKind, FlagLook>> = {
  red: { code: "RED", caption: "RED FLAG", tone: "red", pattern: "full", blinks: false },
  disqualified: {
    code: "DSQ",
    caption: "DISQUALIFIED",
    tone: "white",
    pattern: "frame",
    blinks: false,
  },
  black: { code: "BLK", caption: "BLACK FLAG", tone: "white", pattern: "frame", blinks: false },
  repair: { code: "REP", caption: "REPAIR", tone: "meatball", pattern: "disc", blinks: false },
  furled: { code: "WARN", caption: "WARNING", tone: "white", pattern: "diagonal", blinks: false },
  checkered: {
    code: "CHK",
    caption: "FINISH",
    tone: "white",
    pattern: "checkered",
    blinks: false,
  },
  fullCourseYellow: {
    code: "SC",
    caption: "SAFETY CAR",
    tone: "yellow",
    pattern: "full",
    blinks: true,
  },
  yellow: { code: "YLW", caption: "CAUTION", tone: "yellow", pattern: "full", blinks: true },
  blue: { code: "BLU", caption: "BLUE FLAG", tone: "blue", pattern: "full", blinks: true },
  white: { code: "WHT", caption: "LAST LAP", tone: "white", pattern: "full", blinks: false },
  green: { code: "GRN", caption: "GREEN", tone: "green", pattern: "full", blinks: false },
};

/** Which LEDs of the 6 x 4 grid are lit, row by row from the top left. */
export function ledPattern(pattern: LedPattern): boolean[] {
  const leds: boolean[] = [];
  for (let row = 0; row < LED_ROWS; row++) {
    for (let col = 0; col < LED_COLUMNS; col++) {
      const edge = row === 0 || row === LED_ROWS - 1 || col === 0 || col === LED_COLUMNS - 1;
      const middle = col >= 2 && col <= 3;
      const inner = col >= 1 && col <= 4 && row >= 1 && row <= 2;
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
  /** Header right, e.g. "YLW S2"; "" when no flag. */
  code: string;
  /** Under the grid, e.g. "CAUTION"; "" when no flag. */
  caption: string;
  /** Null when no flag (all LEDs dim). */
  tone: FlagTone | null;
  /** 24 LEDs, row by row. */
  leds: readonly boolean[];
  blink: boolean;
}

export interface DigiFlagOptions {
  /** Blink the LEDs for yellow, safety car and blue. */
  blink: boolean;
  /** Seconds green shows after a start or a cleared caution; 0 never shows it. */
  greenHoldS: number;
}

/** The view for `flag`; `sector` (1-based) is added to a local yellow's code when known. */
export function flagView(
  flag: FlagKind | null,
  sector: number | null,
  options: Pick<DigiFlagOptions, "blink">,
): DigiFlagView {
  if (flag === null) {
    return { flag: null, code: "", caption: "", tone: null, leds: DARK, blink: false };
  }
  const look = LOOKS[flag];
  const code = flag === "yellow" && sector !== null ? `${look.code} S${sector}` : look.code;
  return {
    flag,
    code,
    caption: look.caption,
    tone: look.tone,
    leds: ledPattern(look.pattern),
    blink: options.blink && look.blinks,
  };
}

/** The player's sector (1-based) from the delta tracker's sector timing; null when unknown. */
export function playerSector(frame: TelemetryFrame): number | null {
  const current = frame.derived.delta?.sectors?.current ?? null;
  return current === null ? null : current + 1;
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
  return flagView(flag, flag === "yellow" ? playerSector(frame) : null, options);
}

/** The design's sample, shown in edit mode while no flag is out: a local yellow in sector 2. */
export function sampleDigiFlagView(options: Pick<DigiFlagOptions, "blink">): DigiFlagView {
  return flagView("yellow", 2, options);
}
