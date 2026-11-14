import type { SimName } from "@overlay/sim-core/types";
import type { FieldConfig } from "@overlay/ui/types";

export type SettingValue = boolean | number | string | readonly string[];

/** "accent" follows the active theme's accent; otherwise "#rrggbb". Per-overlay functional colours. */
export type FunctionalColour = "accent" | `#${string}`;

/** Unit of a number setting. Values are stored in this unit; "m" and "km/h" are converted for display. */
export type SettingUnit = "px" | "%" | "s" | "m" | "laps" | "km/h";

export interface SettingOption {
  value: string;
  label: string;
  /** Only meaningful in these sims (greyed out otherwise). */
  sims?: readonly SimName[];
}

interface SettingFieldBase {
  /** Key in OverlayInstanceSettings.options; unique within the overlay; never renamed once shipped. */
  key: string;
  label: string;
  help?: string;
  /** Panel group heading, e.g. "Layout"; fields without one go under "Options". */
  section?: string;
  /** Earlier key of a renamed option: its stored value is read when the new key is absent. */
  legacyKey?: string;
  sims?: readonly SimName[];
}

export type SettingField =
  | (SettingFieldBase & { kind: "toggle"; default: boolean })
  | (SettingFieldBase & {
      kind: "number";
      default: number;
      min: number;
      max: number;
      step: number;
      unit?: SettingUnit;
    })
  | (SettingFieldBase & { kind: "select"; default: string; options: readonly SettingOption[] })
  | (SettingFieldBase & {
      kind: "multi";
      /** Ordered picks, e.g. header fields. */
      default: readonly string[];
      options: readonly SettingOption[];
      /** "Pick up to N". */
      max?: number;
    })
  | (SettingFieldBase & { kind: "colour"; default: FunctionalColour })
  | (SettingFieldBase & {
      kind: "text";
      default: string;
      /** Longest accepted value in characters; a longer one is refused, never cut. */
      maxLength: number;
      /** A text area instead of a one-line input. */
      multiline?: boolean;
      /** Hint shown while empty. */
      placeholder?: string;
      /**
       * "url": empty, or an http(s) address (see shared/web-url). "twitch-channel": empty, or a
       * Twitch channel, stored as its lowercase login (see twitch-chat/channel). A value that does
       * not fit is refused: the stored value stays as it was.
       */
      format?: "url" | "twitch-channel";
    });

/** A visible field, or a column of a table overlay. */
export interface OverlayFieldDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  /** Table overlays: default width (% of the table) in "custom" width mode. */
  defaultWidthPct?: number;
  /**
   * Table overlays: narrowest content width in characters at which the column stays readable.
   * Manifest data only (not stored). The width floor is
   * `max(minChars ?? chars, label chars)` (see `columnFloorChars` in shared/columns).
   */
  minChars?: number;
  /** Table overlays: typical content width in characters. Manifest data only (not stored). */
  chars?: number;
  /**
   * Table overlays: lower numbers are hidden first when the user drags the window narrower than
   * the visible columns need. Never set on position, car number, driver and gap. Manifest data
   * only. Read by the table fit (packages/ui/src/table/fit.ts).
   */
  dropPriority?: number;
  sims?: readonly SimName[];
}

export interface Size {
  width: number;
  height: number;
}

/** A rectangle in an overlay window, CSS px (window DIPs). */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayManifest {
  /** kebab-case and stable: used as a key in settings and layout files. */
  id: string;
  title: string;
  description: string;
  sims: readonly SimName[];
  /** Window size at 100 % scale on first use. */
  defaultSize: Size;
  /** Smallest window size at 100 % scale. */
  minSize: Size;
  /** First-use position relative to the primary display's work area. */
  defaultPosition: { x: number; y: number };
  /** Table-style overlays get Row opacity, column order and column widths in their common settings. */
  table: boolean;
  /** Visible fields (columns for table overlays) in default order. */
  fields: readonly OverlayFieldDef[];
  settings: readonly SettingField[];
  /** Highest telemetry rate the overlay needs; the host caps it at Settings > Performance. */
  rateHz: number;
  defaultEnabled: boolean;
  /** Framework defaults this overlay changes, e.g. hidden in the garage. New settings only. */
  commonDefaults?: Partial<Pick<CommonOverlaySettings, "hideInGarage" | "hideOnTrack">>;
  /** Listed in the Overlays page only while developer tools are on. */
  dev?: boolean;
  /**
   * False for overlays whose content does not come from the sim (Webview, Twitch Chat): they show without
   * telemetry instead of the "no data" notice. Auto-hide still hides them while driving. Default true.
   */
  needsTelemetry?: boolean;
  /**
   * The title bar takes its own row while editing too, instead of lying over the content's top
   * edge (Webview: the embedded page is a native view that would cover it). Default false.
   */
  editTitleBarInFlow?: boolean;
  /**
   * Non-table overlays whose layout option changes the natural window size (Fuel Calculator).
   * When the option's value changes, main sets the window to sizes[value] at the overlay's scale,
   * keeping x/y and clamping to the work area. `defaultSize` equals sizes[the option's default].
   */
  sizeByOption?: { key: string; sizes: Readonly<Record<string, Size>> };
  /**
   * Options an added instance starts with, by instance number - 1 (entry 0 is instance 1, whose
   * values should equal the manifest defaults). An added instance copies the instance it was added
   * from and then takes these, so a second Data Frames tile does not repeat the first metric.
   */
  instanceOptions?: readonly Readonly<Record<string, SettingValue>>[];
}

/** Framework settings every overlay has; they behave the same everywhere. */
export interface CommonOverlaySettings {
  /** Whole-overlay opacity, 20..100 step 5. Default 100. */
  opacityPct: number;
  /** Content and window scale, 50..200 step 5. Default 100. */
  scalePct: number;
  /** Row background opacity, 0..100 step 5. Default 100. Table overlays only (ignored otherwise). */
  rowOpacityPct: number;
  /** Hidden while the player is in the garage (not on track). Default false. */
  hideInGarage: boolean;
  /** Hidden while the player is on track. Default false. */
  hideOnTrack: boolean;
  /** Stay visible with no sim running, even when Settings > General > Auto-hide is on. Default false. */
  alwaysShow: boolean;
  /** Show the title bar above the overlay while driving; it always shows while editing. Default false. */
  showTitleBar: boolean;
  /** Every manifest field exactly once, in the user's order. */
  fields: FieldConfig[];
}

export const COMMON_LIMITS = {
  opacityPct: { min: 20, max: 100, step: 5, default: 100 },
  scalePct: { min: 50, max: 200, step: 5, default: 100 },
  rowOpacityPct: { min: 0, max: 100, step: 5, default: 100 },
} as const;

export interface OverlayInstanceSettings {
  enabled: boolean;
  /** The user's name for this instance; absent means the overlay title (plus its number). */
  name?: string;
  common: CommonOverlaySettings;
  /** One entry per manifest setting key, already validated. */
  options: Record<string, SettingValue>;
}

/** What the settings window sends; every given key replaces the stored value after validation. */
export interface OverlaySettingsPatch {
  enabled?: boolean;
  /** An empty or blank name removes the user's name. */
  name?: string;
  common?: Partial<CommonOverlaySettings>;
  options?: Record<string, SettingValue>;
}

/**
 * Stored as JSON in userData/overlay-settings.json. Keyed by instance: the manifest id for
 * instance 1, "<manifest id>:<n>" for added instances (see instances.ts).
 */
export interface OverlaySettingsFile {
  version: 1;
  overlays: Record<string, OverlayInstanceSettings>;
}
