/**
 * Twitch channel names as typed in the settings: a login name, optionally with a leading "#" or as
 * a channel address (twitch.tv/name). Shared by the settings validation and the main process,
 * which checks again before joining.
 */

/** A Twitch login: 3 to 25 letters, digits or underscores. */
export const TWITCH_LOGIN_RE = /^[a-zA-Z0-9_]{3,25}$/;

/** Longest text accepted in the channel field (room for a pasted address). */
export const MAX_CHANNEL_INPUT_LENGTH = 100;

const TWITCH_HOSTS: ReadonlySet<string> = new Set([
  "twitch.tv",
  "www.twitch.tv",
  "m.twitch.tv",
  "go.twitch.tv",
]);

/** The login part of a twitch.tv address ("https://www.twitch.tv/name/videos" gives "name"). */
function loginFromAddress(text: string): string | null {
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!TWITCH_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.username !== "" || url.password !== "") return null;
  const first = url.pathname.split("/").find((part) => part !== "");
  return first ?? null;
}

/**
 * The lowercase login named by `value` ("#Name", "name", "twitch.tv/Name", "https://www.twitch.tv/name"),
 * or null when it names none (empty, other sites, characters a login cannot have, too short or long).
 */
export function parseTwitchChannel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || text.length > MAX_CHANNEL_INPUT_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  const login = text.includes("/") ? loginFromAddress(text) : text.replace(/^#/, "");
  if (login === null || !TWITCH_LOGIN_RE.test(login)) return null;
  return login.toLowerCase();
}

/** A setting value that is either empty (no channel) or names a channel. */
export function isEmptyOrTwitchChannel(value: unknown): boolean {
  return typeof value === "string" && (value.trim() === "" || parseTwitchChannel(value) !== null);
}

/** What the channel setting stores for `value`: the login, "" when blank, null when refused. */
export function storedTwitchChannel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.trim() === "") return "";
  return parseTwitchChannel(value);
}
