import type { Flags } from "@overlay/sim-core/types";

/** The CSS colour for the player's current flag, or null when none. Checkered shows no border. */
export function flagBorderColour(flags: Flags | null): string | null {
  if (flags === null) return null;
  if (flags.red) return "var(--ov-locked-flag-red)";
  if (flags.black) return "var(--ov-locked-flag-black)";
  if (flags.yellow || flags.fullCourseYellow) return "var(--ov-locked-flag-yellow)";
  if (flags.blue) return "var(--ov-locked-flag-blue)";
  if (flags.white) return "var(--ov-locked-flag-white)";
  if (flags.checkered) return null;
  if (flags.green) return "var(--ov-locked-flag-green)";
  return null;
}
