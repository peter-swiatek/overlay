export type LicenceClass = "R" | "D" | "C" | "B" | "A" | "P";

export function formatIRating(iRating: number | null): string {
  if (iRating === null || !Number.isFinite(iRating)) return "--";
  const n = Math.round(iRating);
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : String(n);
}

const LICENCE_RE = /^\s*(?:class\s+)?(PRO|WC|R|D|C|B|A|P)\b\s*(\d+(?:\.\d+)?)?/i;

/** Accepts "A 3.41", "Class A 3.41", "P 4.99"; "WC" (world championship) is shown as the pro class. */
export function parseLicence(licence: string | null): {
  licenceClass: LicenceClass | null;
  safetyRating: number | null;
} {
  const match = licence === null ? null : LICENCE_RE.exec(licence);
  if (!match) return { licenceClass: null, safetyRating: null };
  const word = (match[1] as string).toUpperCase();
  const licenceClass = (word === "PRO" || word === "WC" ? "P" : word) as LicenceClass;
  const sr = match[2] === undefined ? null : Number(match[2]);
  return { licenceClass, safetyRating: sr !== null && Number.isFinite(sr) ? sr : null };
}

const LICENCE_VARS: Record<LicenceClass, string> = {
  R: "var(--ov-locked-licence-r)",
  D: "var(--ov-locked-licence-d)",
  C: "var(--ov-locked-licence-c)",
  B: "var(--ov-locked-licence-b)",
  A: "var(--ov-locked-licence-a)",
  P: "var(--ov-locked-licence-pro)",
};

export function licenceColourVar(licenceClass: LicenceClass | null): string {
  return licenceClass === null ? "var(--ov-text-muted)" : LICENCE_VARS[licenceClass];
}
