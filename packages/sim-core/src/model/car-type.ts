/** What kind of racing a car is doing, for picking overlay groups. iRacing only. */
export type CarType = "formula" | "sports" | "oval" | "dirt";

/** iRacing WeekendInfo Category. */
export type TrackCategory = "road" | "oval" | "dirtRoad" | "dirtOval";

const TRACK_CATEGORIES: Readonly<Record<string, TrackCategory>> = {
  road: "road",
  oval: "oval",
  dirtroad: "dirtRoad",
  dirtoval: "dirtOval",
};

/** Parses WeekendInfo Category ("Road", "Oval", "DirtRoad", "DirtOval"); null when unknown. */
export function parseTrackCategory(value: string | null | undefined): TrackCategory | null {
  if (typeof value !== "string") return null;
  return TRACK_CATEGORIES[value.replace(/[^a-z]/gi, "").toLowerCase()] ?? null;
}

/**
 * Open-wheel cars, matched against the car name, class short name and CarPath with everything
 * but letters and digits removed (so "IR-18", "ir18" and "Dallara IR18" all match "ir18").
 */
export const FORMULA_KEYWORDS: readonly string[] = [
  "formula",
  "superformula",
  "sf23",
  "sf19",
  "indycar",
  "ir18",
  "ir05",
  "ir01",
  "dallaraf3",
  "dallarair",
  "dallaradw12",
  "skipbarber",
  "ff1600",
  "formulavee",
  "w12",
  "w13",
  "fw31",
  "mp430",
  "lotus79",
  "lotus49",
  "promazda",
  "indypro",
  "usf2000",
  "usf17",
  "pm18",
  "fr20",
  "fr35",
];

/** Short open-wheel names, matched as whole words of the car name or class (e.g. "FIA F4", "FR"). */
export const FORMULA_WORDS: readonly string[] = ["f1", "f2", "f3", "f4", "fr", "fv", "vee", "usf"];

/** Closed-cockpit cars whose names also hold a formula keyword (e.g. "Dallara P217"). */
export const SPORTS_OVERRIDES: readonly string[] = ["p217", "lmp", "gtp", "gt3", "gt4", "gte"];

export interface CarTypeInput {
  carName: string | null;
  /** DriverInfo CarClassShortName. */
  className: string | null;
  /** DriverInfo CarPath, e.g. "dallaraf3". */
  carPath: string | null;
  trackCategory: TrackCategory | null;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/);
}

/**
 * The car type of an iRacing car: Oval on an oval track and Dirt on a dirt one (whatever the
 * car), else Formula for open-wheel cars (see the keyword lists), else Sports car.
 */
export function iracingCarType(input: CarTypeInput): CarType {
  if (input.trackCategory === "oval") return "oval";
  if (input.trackCategory === "dirtRoad" || input.trackCategory === "dirtOval") return "dirt";
  const texts = [input.carName, input.className, input.carPath].filter(
    (t): t is string => typeof t === "string" && t !== "",
  );
  const squashed = texts.map(squash);
  if (squashed.some((t) => SPORTS_OVERRIDES.some((k) => t.includes(k)))) return "sports";
  if (squashed.some((t) => FORMULA_KEYWORDS.some((k) => t.includes(k)))) return "formula";
  const named = [input.carName, input.className].flatMap((t) => (t ? words(t) : []));
  if (named.some((w) => FORMULA_WORDS.includes(w))) return "formula";
  return "sports";
}
