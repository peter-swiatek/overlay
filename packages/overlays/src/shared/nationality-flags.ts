/*
 * Bundled country flags (./flags, 4:3 SVGs from the flag-icons set, see THIRD_PARTY_NOTICES.md),
 * one per code that sim-core's nationalityCode can return.
 */

const FILES = import.meta.glob<string>("./flags/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const BY_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1, -".svg".length),
    url,
  ]),
);

/** The flag image URL for a nationality code; null when there is none. */
export function flagUrl(code: string | null): string | null {
  return code === null ? null : (BY_CODE[code] ?? null);
}
