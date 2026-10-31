/**
 * LMU reports no class colour, so we assign one per class. Keys are normalised class names
 * (see normaliseClassName); the colours are locked and covered by tests.
 */
export const LMU_CLASS_COLOURS: Readonly<Record<string, string>> = {
  hypercar: "#E4002B",
  hyper: "#E4002B",
  lmp2: "#0057B8",
  lmp2elms: "#0057B8",
  elmslmp2: "#0057B8",
  lmp3: "#8A2BE2",
  lmgt3: "#00A651",
  gt3: "#00A651",
  gte: "#FF8200",
  lmgte: "#FF8200",
};

/** Lower-case and drop everything but letters and digits ("LMP2_ELMS" -> "lmp2elms"). */
export function normaliseClassName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Class colour for an LMU class name; null when the class is unknown or missing. */
export function lmuClassColour(className: string | null | undefined): string | null {
  if (className === null || className === undefined) return null;
  return LMU_CLASS_COLOURS[normaliseClassName(className)] ?? null;
}
