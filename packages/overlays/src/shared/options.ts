import type { ColumnWidthMode, Decimals, NameDisplay, NameFormat } from "@overlay/ui/types";
import type { OverlayInstanceSettings, SettingField } from "../contract";
import { optionNumber, optionString } from "../settings";

export type SessionDisplay = "auto" | "time" | "laps";

export interface TableOptions {
  widthMode: ColumnWidthMode;
  widthScalePct: number;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
  nameDisplay: NameDisplay;
  nameFormat: NameFormat;
  sessionDisplay: SessionDisplay;
}

const SECTION = "Table";

/** Setting fields, in this order, all with section "Table". Shared by Relative and Leaderboard. */
export const TABLE_OPTION_FIELDS: readonly SettingField[] = [
  {
    key: "column-width",
    label: "Column width",
    kind: "select",
    section: SECTION,
    default: "auto",
    options: [
      { value: "custom", label: "Custom" },
      { value: "auto", label: "Auto" },
      { value: "compact", label: "Compact" },
    ],
  },
  {
    key: "width-fine-tune",
    label: "Width fine-tune",
    kind: "number",
    section: SECTION,
    default: 100,
    min: 50,
    max: 150,
    step: 5,
    unit: "%",
  },
  {
    key: "gap-decimals",
    label: "Delta / gap decimals",
    kind: "number",
    section: SECTION,
    default: 1,
    min: 0,
    max: 3,
    step: 1,
  },
  {
    key: "lap-decimals",
    label: "Lap time decimals",
    kind: "number",
    section: SECTION,
    default: 3,
    min: 0,
    max: 3,
    step: 1,
  },
  {
    key: "name-display",
    label: "Name display",
    kind: "select",
    section: SECTION,
    default: "driver",
    options: [
      { value: "driver", label: "Driver name only" },
      // LMU team names are parsed and unreliable; LMU still falls back to the driver name.
      { value: "team", label: "Team name only", sims: ["iracing"] },
      { value: "driver-team", label: "Driver + team", sims: ["iracing"] },
    ],
  },
  {
    key: "name-format",
    label: "Name format",
    kind: "select",
    section: SECTION,
    default: "f-last",
    options: [
      { value: "full", label: "Full name" },
      { value: "f-last", label: "F. Last" },
      { value: "first-l", label: "First L." },
      { value: "last", label: "Last only" },
      { value: "first", label: "First only" },
      { value: "last-f", label: "Last, F." },
    ],
  },
  {
    key: "session-display",
    label: "Session display",
    kind: "select",
    section: SECTION,
    default: "auto",
    options: [
      { value: "auto", label: "Auto" },
      { value: "time", label: "Time remaining" },
      { value: "laps", label: "Laps remaining" },
    ],
  },
];

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

function toDecimals(value: number): Decimals {
  const n = Math.min(3, Math.max(0, Math.round(value)));
  return n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3;
}

/** The shared fields with these keys, in TABLE_OPTION_FIELDS order, for an overlay that needs only some. */
export function tableOptionFields(keys: readonly string[]): SettingField[] {
  return TABLE_OPTION_FIELDS.filter((f) => keys.includes(f.key));
}

/**
 * Reads the shared options from settings already sanitised against a manifest that declares them.
 * A key the manifest leaves out (see tableOptionFields) reads as its TABLE_OPTION_FIELDS default.
 */
export function readTableOptions(settings: OverlayInstanceSettings): TableOptions {
  const declared = (key: string): boolean => settings.options[key] !== undefined;
  const fallback = (key: string): SettingField["default"] =>
    TABLE_OPTION_FIELDS.find((f) => f.key === key)?.default ?? "";
  const num = (key: string): number =>
    declared(key) ? optionNumber(settings, key) : Number(fallback(key));
  const str = (key: string): string =>
    declared(key) ? optionString(settings, key) : String(fallback(key));
  return {
    widthMode: oneOf(str("column-width"), ["custom", "auto", "compact"], "auto"),
    widthScalePct: num("width-fine-tune"),
    gapDecimals: toDecimals(num("gap-decimals")),
    lapDecimals: toDecimals(num("lap-decimals")),
    nameDisplay: oneOf(str("name-display"), ["driver", "team", "driver-team"], "driver"),
    nameFormat: oneOf(
      str("name-format"),
      ["full", "f-last", "first-l", "last", "first", "last-f"],
      "f-last",
    ),
    sessionDisplay: oneOf(str("session-display"), ["auto", "time", "laps"], "auto"),
  };
}
