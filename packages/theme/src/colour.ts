export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const HEX_COLOUR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Parses "#rrggbb" or "#rrggbbaa"; null for anything else. Alpha is 0..1. */
export function parseHex(value: string): (Rgb & { a: number }) | null {
  if (!HEX_COLOUR.test(value)) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
    a: value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1,
  };
}

/** Alpha-composites a colour over black. */
export function overBlack(value: string): Rgb | null {
  const c = parseHex(value);
  return c && { r: c.r * c.a, g: c.g * c.a, b: c.b * c.a };
}

/** Composites `top` over an opaque backdrop. */
export function compositeOver(top: string, backdrop: Rgb): Rgb | null {
  const c = parseHex(top);
  if (!c) return null;
  return {
    r: c.r * c.a + backdrop.r * (1 - c.a),
    g: c.g * c.a + backdrop.g * (1 - c.a),
    b: c.b * c.a + backdrop.b * (1 - c.a),
  };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastOfRgb(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG contrast ratio. Colours with alpha are composited over black (the sim image is unknown). */
export function contrastRatio(foreground: string, background: string): number {
  const fg = overBlack(foreground);
  const bg = overBlack(background);
  if (!fg || !bg) throw new Error("contrastRatio needs #rrggbb or #rrggbbaa colours");
  return contrastOfRgb(fg, bg);
}
