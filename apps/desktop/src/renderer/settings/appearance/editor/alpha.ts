const RGB = /^#[0-9a-f]{6}/i;

/** Alpha of "#rrggbb" (100) or "#rrggbbaa" as a whole percent 0..100. */
export function alphaPercentOf(hex: string): number {
  if (hex.length !== 9) return 100;
  const a = parseInt(hex.slice(7, 9), 16);
  return Number.isNaN(a) ? 100 : Math.round((a / 255) * 100);
}

/** Keeps the RGB part of `hex` and sets the alpha; 100 % drops the suffix. */
export function withAlphaPercent(hex: string, percent: number): string {
  const rgb = hex.slice(0, 7).toLowerCase();
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  if (p >= 100) return rgb;
  return (
    rgb +
    Math.round((p / 100) * 255)
      .toString(16)
      .padStart(2, "0")
  );
}

/** Replaces the RGB part and keeps any existing alpha suffix. */
export function withRgb(hex: string, rgb: string): string {
  if (!RGB.test(rgb)) return hex;
  return rgb.slice(0, 7).toLowerCase() + (hex.length === 9 ? hex.slice(7) : "");
}
