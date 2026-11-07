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
import type { TelemetryEvent, TelemetrySourceChoice } from "../../../shared/telemetry-types";
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

export const HEADER_FOOTER_SECTION = "Header and footer";

type MultiSettingField = Extract<SettingField, { kind: "multi" }>;

/** The header and footer pickers (every `multi` setting), in manifest order. */
export function multiFields(manifest: OverlayManifest): MultiSettingField[] {
  return manifest.settings.filter((f): f is MultiSettingField => f.kind === "multi");
}

/**
 * Manifest sections in order of first appearance; fields without a section go last under
 * "Options". `multi` settings are left out: the panel shows them in "Header and footer".
 */
export function panelSections(manifest: OverlayManifest): PanelSection[] {
  const named = new Map<string, SettingField[]>();
  const loose: SettingField[] = [];
  for (const f of manifest.settings) {
    if (f.kind === "multi") continue;
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

/** The sim the page greys things for; null means nothing is greyed. */
export type SimContext = SimName | null;

/** Undefined `sims` means every sim; a null sim (Auto, nothing connected) allows everything. */
export function isAvailableIn(sims: readonly SimName[] | undefined, sim: SimContext): boolean {
  return sims === undefined || sim === null || sims.includes(sim);
}

export function simBadge(sims: readonly SimName[]): string {
  return `${sims.map((s) => SIM_LABELS[s] ?? s).join(" / ")} only`;
}

/** Disabled state and badge for anything that has a `sims` list. */
export function simState(
  sims: readonly SimName[] | undefined,
  sim: SimContext,
): { disabled: boolean; badge: string | undefined } {
  if (sims === undefined || isAvailableIn(sims, sim)) return { disabled: false, badge: undefined };
  return { disabled: true, badge: simBadge(sims) };
}

/**
 * The sim to grey for. A picked game wins; with Auto it is the connected sim, and with nothing
 * connected (or Mock/Replay, which stand in for either sim) it is null, so nothing is greyed.
 */
export function simForGame(
  choice: TelemetrySourceChoice,
  event: Pick<TelemetryEvent, "status" | "source"> | null,
): SimContext {
  if (choice === "iracing" || choice === "lmu") return choice;
  if (choice !== "auto" || event === null || event.status !== "live") return null;
  return event.source === "iracing" || event.source === "lmu" ? event.source : null;
}

/** Selects with this few options render as a segmented control. */
export const SEGMENTED_MAX_OPTIONS = 3;

/** Segmented controls have no per-option state, so sim-limited options keep the dropdown. */
export function isSegmentedSelect(field: Extract<SettingField, { kind: "select" }>): boolean {
  return (
    field.options.length <= SEGMENTED_MAX_OPTIONS &&
    field.options.every((o) => o.sims === undefined)
  );
}

/** "3 of 5" for a limited picker, "3 picked" otherwise. */
export function pickCounter(count: number, max?: number): string {
  return max === undefined ? `${count} picked` : `${count} of ${max}`;
}

/** Moves the pick at `from` to position `to` (drag and drop); keeps at most `max`. */
export function reorderPick(
  values: readonly string[],
  from: number,
  to: number,
  max?: number,
): string[] {
  return movePick(values, from, to - from, max);
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
