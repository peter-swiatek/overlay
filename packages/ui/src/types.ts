/** Settings > General display preferences. Every formatter that shows a unit or a clock takes them. */
export interface DisplayPrefs {
  units: "metric" | "imperial";
  /** Show speeds in mph even when units are metric. */
  speedInMph: boolean;
  timeFormat: "24h" | "12h";
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  units: "metric",
  speedInMph: false,
  timeFormat: "24h",
};

/** Leaderboard and Relative "Name format", shown for "Max Example": */
export type NameFormat =
  | "full" //       Max Example
  | "f-last" //     M. Example
  | "first-l" //    Max E.
  | "last" //       Example
  | "first" //      Max
  | "last-f"; //    Example, M.

/** Leaderboard and Relative "Name display". */
export type NameDisplay = "driver" | "team" | "driver-team";

/** Leaderboard and Relative "Column width". */
export type ColumnWidthMode = "custom" | "auto" | "compact";

export type Decimals = 0 | 1 | 2 | 3;

/** One column (table overlays) or field (other overlays) as the user configured it. Arrays are ordered. */
export interface FieldConfig {
  id: string;
  visible: boolean;
  /** Custom column width as a share of the table width, 1..100; null = the column's default. */
  widthPct: number | null;
}
