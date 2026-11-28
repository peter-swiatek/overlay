/**
 * Addresses an overlay may embed: plain web pages over http or https only. Shared by the settings
 * validation, the overlay window and the main process, which checks again before loading.
 */

/** Longest address accepted, in characters. */
export const MAX_WEB_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * The normalised address (`URL.href`) of `value` when it is an http or https URL with a host and
 * no user name or password; null otherwise (empty, other schemes such as file: or javascript:,
 * relative paths, too long, control characters).
 */
export function parseWebPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || text.length > MAX_WEB_URL_LENGTH) return null;
  // URL() silently drops tabs and newlines; an address typed with them is not what it shows.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.hostname === "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

/** True for an address `parseWebPageUrl` accepts. */
export function isWebPageUrl(value: unknown): boolean {
  return parseWebPageUrl(value) !== null;
}

/** A setting value that is either empty (no page) or a web page address. */
export function isEmptyOrWebPageUrl(value: unknown): boolean {
  return typeof value === "string" && (value.trim() === "" || isWebPageUrl(value));
}
