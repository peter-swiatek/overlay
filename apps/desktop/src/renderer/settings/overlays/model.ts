import type {
  OverlayFieldDef,
  OverlayInstanceSettings,
  OverlayManifest,
  SettingField,
  SettingUnit,
} from "@overlay/overlays/contract";
import { defaultInstanceSettings, sanitizeOptionValue } from "@overlay/overlays/settings";
import type { SimName } from "@overlay/sim-core/types";
import type { DisplayPrefs, FieldConfig } from "@overlay/ui/types";
import { displayDecimals, displayFactor, roundTo } from "./units";

export const FALLBACK_COLOUR = "#ffc400";
export const OPTIONS_SECTION = "Options";

type AllSettings = Readonly<Record<string, OverlayInstanceSettings>>;

/** Settings for an overlay, falling back to defaults for a missing entry. */
export function settingsOf(manifest: OverlayManifest, all: AllSettings): OverlayInstanceSettings {
  return all[manifest.id] ?? defaultInstanceSettings(manifest);
}

export function listOverlays(
  manifests: readonly OverlayManifest[],
  all: AllSettings,
  developerEnabled: boolean,
): { active: OverlayManifest[]; available: OverlayManifest[] } {
  const active: OverlayManifest[] = [];
  const available: OverlayManifest[] = [];
  for (const m of manifests) {
    if (m.dev && !developerEnabled) continue;
    (settingsOf(m, all).enabled ? active : available).push(m);
  }
  return { active, available };
}

export interface PanelSection {
  title: string;
  fields: SettingField[];
}

/** Sections in order of first appearance; fields without a section go last under "Options". */
export function panelSections(manifest: OverlayManifest): PanelSection[] {
  const named = new Map<string, SettingField[]>();
  const loose: SettingField[] = [];
  for (const f of manifest.settings) {
    if (f.section === undefined) {
      loose.push(f);
      continue;
    }
    const list = named.get(f.section) ?? [];
    list.push(f);
    named.set(f.section, list);
  }
  const sections = [...named].map(([title, fields]) => ({ title, fields }));
  if (loose.length > 0) sections.push({ title: OPTIONS_SECTION, fields: loose });
  return sections;
}

export const SIM_LABELS: Readonly<Record<SimName, string>> = { iracing: "iRacing", lmu: "LMU" };

/** Undefined `sims` means every sim. */
export function isAvailableIn(sims: readonly SimName[] | undefined, sim: SimName): boolean {
  return sims === undefined || sims.includes(sim);
}

export function simBadge(sims: readonly SimName[]): string {
  return `${sims.map((s) => SIM_LABELS[s] ?? s).join(" / ")} only`;
}

/** Disabled state and badge for anything that has a `sims` list. */
export function simState(
  sims: readonly SimName[] | undefined,
  sim: SimName,
): { disabled: boolean; badge: string | undefined } {
  if (sims === undefined || isAvailableIn(sims, sim)) return { disabled: false, badge: undefined };
  return { disabled: true, badge: simBadge(sims) };
}

/** The sim filter's default: the connected sim, else iRacing. */
export function simFromSource(source: string | null | undefined): SimName {
  return source === "lmu" ? "lmu" : "iracing";
}

export function toDisplay(
  unit: SettingUnit | undefined,
  value: number,
  prefs: DisplayPrefs,
  step?: number,
): number {
  const decimals = step === undefined ? 1 : displayDecimals(unit, step, prefs);
  return roundTo(value * displayFactor(unit, prefs), decimals);
}

/**
 * Shown value -> stored value, snapped to the field's step. When the snap gives back `current`
 * although the user moved the shown value, move one stored step that way so small steps still move.
 */
export function fromDisplay(
  unit: SettingUnit | undefined,
  shown: number,
  prefs: DisplayPrefs,
  field: Extract<SettingField, { kind: "number" }>,
  current: number,
): number {
  const snapped = sanitizeOptionValue(field, shown / displayFactor(unit, prefs));
  if (typeof snapped === "number" && snapped !== current) return snapped;
  const shownNow = toDisplay(unit, current, prefs, field.step);
  if (shown === shownNow) return current;
  const moved = sanitizeOptionValue(field, current + (shown > shownNow ? field.step : -field.step));
  return typeof moved === "number" ? moved : current;
}

/** Appends `value` unless it is already picked or the list is full. */
export function addPick(values: readonly string[], value: string, max?: number): string[] {
  if (values.includes(value)) return [...values];
  if (max !== undefined && values.length >= max) return [...values];
  return [...values, value];
}

export function removePick(values: readonly string[], value: string): string[] {
  return values.filter((v) => v !== value);
}

export function movePick(
  values: readonly string[],
  index: number,
  delta: number,
  max?: number,
): string[] {
  const list = [...values];
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const [item] = list.splice(index, 1);
  if (item === undefined) return list;
  list.splice(to, 0, item);
  return max === undefined ? list : list.slice(0, max);
}

export function moveField(fields: readonly FieldConfig[], from: number, to: number): FieldConfig[] {
  const list = fields.map((f) => ({ ...f }));
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const [item] = list.splice(from, 1);
  if (item) list.splice(to, 0, item);
  return list;
}

export function setFieldPatch(
  fields: readonly FieldConfig[],
  id: string,
  change: Partial<Pick<FieldConfig, "visible" | "widthPct">>,
): FieldConfig[] {
  return fields.map((f) => (f.id === id ? { ...f, ...change } : { ...f }));
}

export function fieldDef(manifest: OverlayManifest, id: string): OverlayFieldDef | undefined {
  return manifest.fields.find((f) => f.id === id);
}

/** Width shown in a column's slider. */
export function shownWidthPct(config: FieldConfig, def: OverlayFieldDef | undefined): number {
  return config.widthPct ?? def?.defaultWidthPct ?? 10;
}
