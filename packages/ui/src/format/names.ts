import type { NameDisplay, NameFormat } from "../types";

/** First Unicode code point, upper-cased, so surrogate pairs are never split. */
function initial(token: string): string {
  const first = Array.from(token)[0] ?? "";
  return `${first.toUpperCase()}.`;
}

export function formatDriverName(name: string | null, format: NameFormat): string {
  if (name === null) return "";
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0] as string;
  const first = tokens[0] as string;
  const last = tokens[tokens.length - 1] as string;
  switch (format) {
    case "full":
      return tokens.join(" ");
    case "f-last":
      return `${initial(first)} ${last}`;
    case "first-l":
      return `${first} ${initial(last)}`;
    case "last":
      return last;
    case "first":
      return first;
    case "last-f":
      return `${last}, ${initial(first)}`;
  }
}

export function formatNameDisplay(
  driver: string | null,
  team: string | null,
  display: NameDisplay,
  format: NameFormat,
): string {
  const d = driver === null ? "" : formatDriverName(driver, format);
  const t = team === null ? "" : team.trim().replace(/\s+/g, " ");
  if (display === "driver") return d || t;
  if (display === "team") return t || d;
  return d && t ? `${d} · ${t}` : d || t;
}
