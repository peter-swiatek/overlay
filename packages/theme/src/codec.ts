import { newCustomId, sanitizeTheme, type ThemeResult } from "./sanitize";
import type { Theme } from "./types";

export const THEME_CODE_PREFIX = "OVT1.";
export const MAX_THEME_CODE_LENGTH = 4096;
export const MAX_THEME_FILE_BYTES = 64 * 1024;

const FILE_FORMAT = "overlay-theme";

function shareable(theme: Theme): Omit<Theme, "id"> {
  return {
    name: theme.name,
    tokens: theme.tokens,
    font: theme.font,
    weight: theme.weight,
    compact: theme.compact,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeThemeCode(theme: Theme): string {
  const bytes = new TextEncoder().encode(JSON.stringify(shareable(theme)));
  return THEME_CODE_PREFIX + toBase64Url(bytes);
}

function withFreshId(result: ThemeResult, random?: () => number): ThemeResult {
  return result.ok ? { ok: true, theme: { ...result.theme, id: newCustomId(random) } } : result;
}

export function decodeThemeCode(code: string, random?: () => number): ThemeResult {
  const text = code.replace(/\s+/g, "");
  if (text.length > MAX_THEME_CODE_LENGTH) return { ok: false, error: "This code is too long" };
  if (!text.startsWith(THEME_CODE_PREFIX)) {
    return { ok: false, error: "This is not a theme code" };
  }
  const bytes = fromBase64Url(text.slice(THEME_CODE_PREFIX.length));
  if (!bytes) return { ok: false, error: "This theme code is damaged" };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: "This theme code is damaged" };
  }
  return withFreshId(sanitizeTheme(raw), random);
}

export function serializeThemeFile(theme: Theme): string {
  return `${JSON.stringify({ format: FILE_FORMAT, version: 1, ...shareable(theme) }, null, 2)}\n`;
}

export function parseThemeFile(text: string, random?: () => number): ThemeResult {
  if (text.length > MAX_THEME_FILE_BYTES) return { ok: false, error: "This theme file is too big" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This is not a theme file" };
  }
  const head = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if (head.format !== FILE_FORMAT) return { ok: false, error: "This is not a theme file" };
  if (head.version !== 1) return { ok: false, error: "This theme file is from a newer version" };
  return withFreshId(sanitizeTheme(raw), random);
}
