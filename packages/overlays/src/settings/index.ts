import type { FieldConfig } from "@overlay/ui/types";
import {
  COMMON_LIMITS,
  type CommonOverlaySettings,
  type OverlayInstanceSettings,
  type OverlayManifest,
  type OverlaySettingsFile,
  type SettingField,
  type SettingValue,
} from "../contract";
import { instanceNumber, isAddedInstance, MAX_INSTANCE_NAME, parseInstanceId } from "../instances";

type Obj = Record<string, unknown>;
type NumberLimits = { min: number; max: number; step: number };

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function has(o: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** Clamps to [min, max] and snaps to `step` counted from `min`; undefined for non-finite input. */
function parseNumber(value: unknown, limits: NumberLimits): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const { min, max, step } = limits;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  let snapped = min + Math.round((clamped - min) / step) * step;
  if (snapped > max) snapped -= step;
  if (snapped < min) snapped = min;
  // Remove floating error such as 0.30000000000000004.
  return Number(snapped.toFixed(10));
}

const COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

/** The validated value, or undefined when `value` is not acceptable for the field. */
function parseOptionValue(field: SettingField, value: unknown): SettingValue | undefined {
  switch (field.kind) {
    case "toggle":
      return typeof value === "boolean" ? value : undefined;
    case "number":
      return parseNumber(value, field);
    case "select":
      return typeof value === "string" && field.options.some((o) => o.value === value)
        ? value
        : undefined;
    case "colour":
      if (value === "accent") return "accent";
      return typeof value === "string" && COLOUR_RE.test(value) ? value.toLowerCase() : undefined;
    case "multi": {
      if (!Array.isArray(value)) return undefined;
      const allowed = new Set(field.options.map((o) => o.value));
      const picked: string[] = [];
      for (const item of value as unknown[]) {
        if (typeof item === "string" && allowed.has(item) && !picked.includes(item)) {
          picked.push(item);
        }
      }
      return field.max === undefined ? picked : picked.slice(0, Math.max(0, field.max));
    }
  }
}

/** Invalid values give the field's default. */
export function sanitizeOptionValue(field: SettingField, value: unknown): SettingValue {
  return parseOptionValue(field, value) ?? field.default;
}

export function defaultCommonSettings(manifest: OverlayManifest): CommonOverlaySettings {
  return {
    opacityPct: COMMON_LIMITS.opacityPct.default,
    scalePct: COMMON_LIMITS.scalePct.default,
    rowOpacityPct: COMMON_LIMITS.rowOpacityPct.default,
    hideInGarage: false,
    hideOnTrack: false,
    ...manifest.commonDefaults,
    alwaysShow: false,
    showTitleBar: false,
    fields: manifest.fields.map((f) => ({ id: f.id, visible: f.defaultVisible, widthPct: null })),
  };
}

export function defaultOptions(manifest: OverlayManifest): Record<string, SettingValue> {
  const options: Record<string, SettingValue> = {};
  for (const setting of manifest.settings) options[setting.key] = setting.default;
  return options;
}

/** Settings a fresh install starts with: every field and setting at its manifest default. */
export function defaultInstanceSettings(manifest: OverlayManifest): OverlayInstanceSettings {
  return {
    enabled: manifest.defaultEnabled,
    common: defaultCommonSettings(manifest),
    options: defaultOptions(manifest),
  };
}

/**
 * Stored field order, cleaned: known ids only, no duplicates, manifest fields the list lacks
 * appended with their defaults. Always holds every manifest field exactly once.
 */
export function mergeFieldConfig(manifest: OverlayManifest, stored: unknown): FieldConfig[] {
  const defs = new Map(manifest.fields.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: FieldConfig[] = [];
  if (Array.isArray(stored)) {
    for (const item of stored as unknown[]) {
      if (!isObj(item) || typeof item.id !== "string") continue;
      const def = defs.get(item.id);
      if (!def || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({
        id: item.id,
        visible: typeof item.visible === "boolean" ? item.visible : def.defaultVisible,
        widthPct: parseNumber(item.widthPct, { min: 1, max: 100, step: 0 }) ?? null,
      });
    }
  }
  for (const def of manifest.fields) {
    if (!seen.has(def.id)) out.push({ id: def.id, visible: def.defaultVisible, widthPct: null });
  }
  return out;
}

const COMMON_NUMBER_KEYS = ["opacityPct", "scalePct", "rowOpacityPct"] as const;
const COMMON_BOOLEAN_KEYS = ["hideInGarage", "hideOnTrack", "alwaysShow", "showTitleBar"] as const;

/** Validated common keys present in `raw`; invalid or absent ones are left out. */
function parseCommonPartial(
  manifest: OverlayManifest,
  raw: unknown,
): Partial<CommonOverlaySettings> {
  const out: Partial<CommonOverlaySettings> = {};
  if (!isObj(raw)) return out;
  for (const key of COMMON_NUMBER_KEYS) {
    const v = parseNumber(raw[key], COMMON_LIMITS[key]);
    if (v !== undefined) out[key] = v;
  }
  for (const key of COMMON_BOOLEAN_KEYS) {
    const v = raw[key];
    if (typeof v === "boolean") out[key] = v;
  }
  if (Array.isArray(raw.fields)) out.fields = mergeFieldConfig(manifest, raw.fields);
  return out;
}

function parseOptionsPartial(
  manifest: OverlayManifest,
  raw: unknown,
): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  if (!isObj(raw)) return out;
  for (const setting of manifest.settings) {
    const from = has(raw, setting.key)
      ? setting.key
      : setting.legacyKey !== undefined && has(raw, setting.legacyKey)
        ? setting.legacyKey
        : null;
    if (from === null) continue;
    const v = parseOptionValue(setting, raw[from]);
    if (v !== undefined) out[setting.key] = v;
  }
  return out;
}

/** A trimmed instance name of at most MAX_INSTANCE_NAME characters; "" means "no name". */
function parseName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_INSTANCE_NAME).trim();
}

/** `settings` with `name` set, or without a name when it is undefined or "". */
function withName(
  settings: OverlayInstanceSettings,
  name: string | undefined,
): OverlayInstanceSettings {
  const next = { ...settings };
  delete next.name;
  return name === undefined || name === "" ? next : { ...next, name };
}

/** Untrusted stored data to valid settings: anything wrong falls back to the manifest default. */
export function sanitizeInstanceSettings(
  manifest: OverlayManifest,
  raw: unknown,
): OverlayInstanceSettings {
  const src = isObj(raw) ? raw : {};
  const defaults = defaultInstanceSettings(manifest);
  const common = isObj(src.common) ? src.common : {};
  const name = parseName(src.name);
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : defaults.enabled,
    ...(name ? { name } : {}),
    common: {
      ...defaults.common,
      ...parseCommonPartial(manifest, common),
      // Also fills in a list that was missing or not an array.
      fields: mergeFieldConfig(manifest, common.fields),
    },
    options: { ...defaults.options, ...parseOptionsPartial(manifest, src.options) },
  };
}

/** Applies a patch from the settings window; invalid parts are ignored. */
export function applySettingsPatch(
  manifest: OverlayManifest,
  current: OverlayInstanceSettings,
  patch: unknown,
): OverlayInstanceSettings {
  if (!isObj(patch)) return current;
  const next: OverlayInstanceSettings = {
    ...current,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    common: { ...current.common, ...parseCommonPartial(manifest, patch.common) },
    options: { ...current.options, ...parseOptionsPartial(manifest, patch.options) },
  };
  return has(patch, "name") ? withName(next, parseName(patch.name) ?? current.name) : next;
}

/** The manifest's `instanceOptions` entry for instance key `id`; empty when it has none. */
function instanceOptionsFor(manifest: OverlayManifest, id: string): Record<string, SettingValue> {
  return { ...manifest.instanceOptions?.[instanceNumber(id) - 1] };
}

/**
 * Settings of a newly added instance `id`: a copy of `source` (the instance it was added from),
 * switched on, without the source's name, then the manifest's `instanceOptions` for its number.
 */
export function newInstanceSettings(
  manifest: OverlayManifest,
  source: OverlayInstanceSettings,
  id: string,
): OverlayInstanceSettings {
  const copy = withName({ ...structuredClone(source), enabled: true }, undefined);
  return applySettingsPatch(manifest, copy, { options: instanceOptionsFor(manifest, id) });
}

/**
 * "Reset to defaults" for instance `id`. Instance 1 goes back to the manifest defaults, the
 * enabled state included. An added instance keeps its enabled state and name and gets its
 * `instanceOptions` again, so a reset never moves it in the list or renames it.
 */
export function resetInstanceSettings(
  manifest: OverlayManifest,
  current: OverlayInstanceSettings | undefined,
  id: string,
): OverlayInstanceSettings {
  const defaults = defaultInstanceSettings(manifest);
  if (!isAddedInstance(id) || current === undefined) return defaults;
  const kept = withName({ ...defaults, enabled: current.enabled }, current.name);
  return applySettingsPatch(manifest, kept, { options: instanceOptionsFor(manifest, id) });
}

export function parseOverlaySettingsFile(
  raw: unknown,
  manifests: readonly OverlayManifest[],
): OverlaySettingsFile {
  const stored = isObj(raw) && raw.version === 1 && isObj(raw.overlays) ? raw.overlays : {};
  const overlays: Record<string, OverlayInstanceSettings> = {};
  for (const manifest of manifests) {
    overlays[manifest.id] = sanitizeInstanceSettings(
      manifest,
      has(stored, manifest.id) ? stored[manifest.id] : undefined,
    );
  }
  // Added instances of known overlays, in manifest order then by number. Bad keys are dropped.
  const added = Object.keys(stored)
    .map((id) => ({ id, ref: parseInstanceId(id) }))
    .filter((e) => e.ref !== null && e.ref.n >= 2)
    .map((e) => ({ ...e, index: manifests.findIndex((m) => m.id === e.ref?.overlayId) }))
    .filter((e) => e.index >= 0)
    .sort((a, b) => a.index - b.index || (a.ref?.n ?? 0) - (b.ref?.n ?? 0));
  for (const { id, index } of added) {
    overlays[id] = sanitizeInstanceSettings(manifests[index] as OverlayManifest, stored[id]);
  }
  return { version: 1, overlays };
}

/** Visible fields in the user's order. */
export function visibleFields(settings: OverlayInstanceSettings): FieldConfig[] {
  return settings.common.fields.filter((f) => f.visible);
}

function option(settings: OverlayInstanceSettings, key: string, type: string): SettingValue {
  const value = settings.options[key];
  const ok =
    type === "strings"
      ? Array.isArray(value) && value.every((v) => typeof v === "string")
      : typeof value === type;
  if (value === undefined || !ok) {
    throw new Error(`Overlay option "${key}" is missing or not a ${type}`);
  }
  return value;
}

export function optionBoolean(settings: OverlayInstanceSettings, key: string): boolean {
  return option(settings, key, "boolean") as boolean;
}
export function optionNumber(settings: OverlayInstanceSettings, key: string): number {
  return option(settings, key, "number") as number;
}
export function optionString(settings: OverlayInstanceSettings, key: string): string {
  return option(settings, key, "string") as string;
}
export function optionStrings(settings: OverlayInstanceSettings, key: string): readonly string[] {
  return option(settings, key, "strings") as readonly string[];
}
