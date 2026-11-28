import type { FitContent, OverlayManifest, SettingValue } from "../contract";

/**
 * Which window edges of an overlay follow its content with these options: the manifest's
 * `fitContent`, "none" while `fitContentOffWhen` matches, and at most "height" for a table
 * overlay (its width has its own column fit).
 */
export function fitContentOf(
  manifest: Pick<OverlayManifest, "fitContent" | "fitContentOffWhen" | "table">,
  options: Readonly<Record<string, SettingValue>>,
): FitContent {
  const axis = manifest.fitContent ?? "none";
  const off = manifest.fitContentOffWhen;
  if (off && options[off.key] === off.value) return "none";
  if (manifest.table && axis === "both") return "height";
  return axis;
}
