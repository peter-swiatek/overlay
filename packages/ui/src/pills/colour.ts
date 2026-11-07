import { LOCKED_COLOURS } from "@overlay/theme";
import type { LicenceClass } from "../format/licence";

/** WCAG relative luminance of "#rgb" or "#rrggbb"; null when the value is not a hex colour. */
export function hexLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1] as string;
  if (h.length === 3) h = Array.from(h, (c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DARK = "#000000";
const LIGHT = "#ffffff";

/** Dark or light text for a background; unknown colours get light text. */
export function readableTextColour(backgroundHex: string): string {
  const l = hexLuminance(backgroundHex);
  // Crossover where black and white text have equal contrast: L = 0.179.
  return l !== null && l > 0.179 ? DARK : LIGHT;
}

const LICENCE_KEYS = {
  R: "licenceR",
  D: "licenceD",
  C: "licenceC",
  B: "licenceB",
  A: "licenceA",
  P: "licencePro",
} as const satisfies Record<LicenceClass, keyof typeof LOCKED_COLOURS>;

/** Text colour chosen from the luminance of the locked licence colour; unknown gets light text. */
export function licenceTextColour(licenceClass: LicenceClass | null): string {
  return licenceClass === null
    ? LIGHT
    : readableTextColour(LOCKED_COLOURS[LICENCE_KEYS[licenceClass]]);
}
