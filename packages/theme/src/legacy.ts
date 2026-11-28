import { DEFAULT_TYPOGRAPHY } from "./presets";
import { sanitizeTypography } from "./sanitize";
import type { Typography } from "./types";

/**
 * The typography each built-in theme carried before typography became a global preference.
 * Read only by migrateLegacyTypography, so a user on one of these keeps the look they had.
 */
const LEGACY_PRESET_TYPOGRAPHY: Readonly<Record<string, Typography>> = Object.freeze({
  graphite: { font: "inter", weight: 500, compact: false },
  midnight: { font: "manrope", weight: 500, compact: false },
  carbon: { font: "barlow-condensed", weight: 600, compact: true },
  paddock: { font: "inter", weight: 600, compact: false },
  glacier: { font: "inter", weight: 600, compact: false },
  aurora: { font: "oswald", weight: 500, compact: false },
});

/**
 * One-time migration for a themes file written before typography left themes: the global
 * typography becomes what the active theme showed. An active custom theme gives its own
 * font, weight and compact values (each invalid or missing one falls back to the default); an
 * active built-in theme gives what it used to carry; anything else gives the defaults.
 */
export function migrateLegacyTypography(activeId: unknown, rawCustom: unknown): Typography {
  if (typeof activeId === "string") {
    if (Array.isArray(rawCustom)) {
      const match = (rawCustom as unknown[]).find(
        (t) =>
          typeof t === "object" && t !== null && (t as Record<string, unknown>).id === activeId,
      );
      if (match !== undefined) return sanitizeTypography(match);
    }
    if (Object.hasOwn(LEGACY_PRESET_TYPOGRAPHY, activeId)) {
      return { ...LEGACY_PRESET_TYPOGRAPHY[activeId]! };
    }
  }
  return { ...DEFAULT_TYPOGRAPHY };
}
