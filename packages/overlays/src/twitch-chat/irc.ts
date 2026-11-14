/**
 * Twitch chat over IRC: a parser for the lines the server sends and the conversion of the ones the
 * overlay shows into chat events. Pure; no network here.
 */
import type { ChatEvent, ChatMessage, ChatRole, EmoteRange } from "./types";

export interface IrcMessage {
  /** IRCv3 message tags, values unescaped. A tag without a value maps to "". */
  tags: Record<string, string>;
  /** "nick!user@host" or a server name, without the leading ":"; null when absent. */
  prefix: string | null;
  /** Upper-case command or a three-digit reply code. */
  command: string;
  /** Middle parameters, then the trailing one (without its ":"). */
  params: string[];
}

/** Longest message text kept, in UTF-16 units (Twitch allows 500 characters). */
export const MAX_MESSAGE_LENGTH = 1000;
/** Longest display name kept. */
const MAX_NAME_LENGTH = 64;

/** Unescapes an IRCv3 tag value: \: ; \s space, \\ backslash, \r and \n. */
export function unescapeTagValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = value[++i];
    if (next === undefined) break;
    if (next === ":") out += ";";
    else if (next === "s") out += " ";
    else if (next === "r") out += "\r";
    else if (next === "n") out += "\n";
    else out += next;
  }
  return out;
}

function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(";")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key === "" || key === "__proto__") continue;
    tags[key] = eq === -1 ? "" : unescapeTagValue(part.slice(eq + 1));
  }
  return tags;
}

/** Parses one IRC line (without its CR LF); null when it is not a message. */
export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.replace(/[\r\n]+$/, "");
  let tags: Record<string, string> = {};
  let prefix: string | null = null;
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    if (space === -1) return null;
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1).trimStart();
  }
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    if (space === -1) return null;
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1).trimStart();
  }
  const params: string[] = [];
  let command = "";
  while (rest !== "") {
    if (command !== "" && rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const space = rest.indexOf(" ");
    const word = space === -1 ? rest : rest.slice(0, space);
    rest = space === -1 ? "" : rest.slice(space + 1).trimStart();
    if (command === "") command = word.toUpperCase();
    else params.push(word);
  }
  if (!/^([A-Z]+|\d{3})$/.test(command)) return null;
  return { tags, prefix, command, params };
}

/** The nick of a "nick!user@host" prefix, lowercase; null for a server prefix or none. */
export function nickOf(prefix: string | null): string | null {
  if (prefix === null) return null;
  const bang = prefix.indexOf("!");
  const nick = bang === -1 ? prefix : prefix.slice(0, bang);
  return /^[a-zA-Z0-9_]{1,25}$/.test(nick) ? nick.toLowerCase() : null;
}

/** Badge names of a badges tag ("broadcaster/1,subscriber/12" gives broadcaster and subscriber). */
export function parseBadges(value: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!value) return names;
  for (const part of value.split(",")) {
    const name = part.split("/")[0];
    if (name) names.add(name);
  }
  return names;
}

/** The highest role among the badges, or null. Founders count as subscribers. */
export function roleOf(badges: ReadonlySet<string>): ChatRole | null {
  if (badges.has("broadcaster")) return "broadcaster";
  if (badges.has("moderator")) return "moderator";
  if (badges.has("vip")) return "vip";
  if (badges.has("subscriber") || badges.has("founder")) return "subscriber";
  return null;
}

/**
 * Emote ranges of an emotes tag ("25:0-4,12-16/1902:6-10"), sorted, in code points. Malformed or
 * overlapping ranges are dropped.
 */
export function parseEmotes(value: string | undefined): EmoteRange[] {
  if (!value) return [];
  const ranges: EmoteRange[] = [];
  for (const emote of value.split("/")) {
    const colon = emote.indexOf(":");
    if (colon === -1) continue;
    for (const span of emote.slice(colon + 1).split(",")) {
      const m = /^(\d{1,5})-(\d{1,5})$/.exec(span);
      if (!m) continue;
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (end >= start) ranges.push({ start, end });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const kept: EmoteRange[] = [];
  for (const r of ranges) {
    const last = kept.at(-1);
    if (last === undefined || r.start > last.end) kept.push(r);
  }
  return kept;
}

export interface TextSegment {
  text: string;
  emote: boolean;
}

/**
 * Splits `text` into plain and emote runs (ranges in code points, as Twitch counts them). Emotes
 * stay text: the overlay never loads their images.
 */
export function messageSegments(text: string, emotes: readonly EmoteRange[]): TextSegment[] {
  const points = Array.from(text);
  const segments: TextSegment[] = [];
  const push = (from: number, to: number, emote: boolean): void => {
    if (to <= from) return;
    const piece = points.slice(from, to).join("");
    const last = segments.at(-1);
    if (last && last.emote === emote && !emote) last.text += piece;
    else segments.push({ text: piece, emote });
  };
  let at = 0;
  for (const r of emotes) {
    if (r.start < at || r.end >= points.length) continue;
    push(at, r.start, false);
    push(r.start, r.end + 1, true);
    at = r.end + 1;
  }
  push(at, points.length, false);
  return segments;
}

/** Removes control characters (newlines included) and cuts overly long text. */
export function cleanText(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  return clean.length > max ? clean.slice(0, max) : clean;
}

// /me arrives wrapped in CTCP: \x01ACTION text\x01.
// eslint-disable-next-line no-control-regex
const ACTION_RE = /^\u0001ACTION (.*?)\u0001?$/s;

function timestamp(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d{10,15}$/.test(value)) return fallback;
  return Number(value);
}

/** A chat message from a PRIVMSG to `channel`; null for other channels or a malformed line. */
export function chatMessageOf(
  msg: IrcMessage,
  channel: string,
  receivedAt: number,
  fallbackId: () => string,
): ChatMessage | null {
  if (msg.command !== "PRIVMSG" || msg.params.length < 2) return null;
  if (msg.params[0]?.toLowerCase() !== `#${channel}`) return null;
  const login = nickOf(msg.prefix);
  if (login === null) return null;
  let raw = msg.params[1] ?? "";
  const action = ACTION_RE.exec(raw);
  if (action) raw = action[1] ?? "";
  const text = cleanText(raw, MAX_MESSAGE_LENGTH);
  const t = msg.tags;
  const display = cleanText(t["display-name"] ?? "", MAX_NAME_LENGTH).trim();
  const color = t["color"] ?? "";
  const id = t["id"] ?? "";
  const userId = t["user-id"] ?? "";
  return {
    id: /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : fallbackId(),
    login,
    userId: /^\d{1,20}$/.test(userId) ? userId : null,
    name: display === "" ? login : display,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null,
    role: roleOf(parseBadges(t["badges"])),
    text,
    action: action !== null,
    // Ranges index the original text; drop them if cleaning changed it.
    emotes: text === raw ? parseEmotes(t["emotes"]) : [],
    sentAt: timestamp(t["tmi-sent-ts"], receivedAt),
    receivedAt,
  };
}

/**
 * The chat event a line from the server means for `channel`: a message, a user's messages
 * cleared (timeout or ban), the whole chat cleared, or one message deleted. Null for anything else.
 */
export function chatEventOf(
  msg: IrcMessage,
  channel: string,
  receivedAt: number,
  fallbackId: () => string,
): ChatEvent | null {
  const target = msg.params[0]?.toLowerCase();
  switch (msg.command) {
    case "PRIVMSG": {
      const message = chatMessageOf(msg, channel, receivedAt, fallbackId);
      return message && { type: "message", message };
    }
    case "CLEARCHAT": {
      if (target !== `#${channel}`) return null;
      const user = msg.params[1];
      if (user === undefined || user === "") return { type: "clear-all" };
      const login = user.toLowerCase();
      if (!/^[a-z0-9_]{1,25}$/.test(login)) return null;
      const id = msg.tags["target-user-id"];
      return { type: "clear-user", login, userId: id && /^\d{1,20}$/.test(id) ? id : null };
    }
    case "CLEARMSG": {
      if (target !== `#${channel}`) return null;
      const id = msg.tags["target-msg-id"];
      return id ? { type: "delete", id } : null;
    }
    default:
      return null;
  }
}
