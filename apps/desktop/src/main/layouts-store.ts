import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { manifestForInstance } from "@overlay/overlays/instances";
import type { SimName } from "@overlay/sim-core/types";
import {
  CAR_TYPES,
  DEFAULT_LAYOUT_ID,
  FALLBACK_GROUP_NAME,
  LAYOUT_SESSION_TYPES,
  LAYOUT_SIMS,
  MAX_CAR_NAME,
  MAX_LAYOUT_CARS,
  MAX_LAYOUT_NAME,
  SIM_LABELS,
  offeredForGame,
  type LayoutMatch,
  type LayoutView,
} from "../shared/layout-types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";
import { parseLayout, type Layout } from "./layout";
import { sameCarName } from "./layout-match";

/**
 * One overlay group (stored as a layout): where every placed instance sits, which instances are
 * on, and when the group is picked.
 */
export interface StoredLayout {
  id: string;
  name: string;
  match: LayoutMatch;
  /** Instance id to on/off. An instance missing here is off in this group. */
  enabled: Record<string, boolean>;
  bounds: Layout;
}

/** The contents of layouts.json. Version 2 added games, car types and the starter groups. */
export interface LayoutsFile {
  version: 2;
  activeId: string;
  autoSwitch: boolean;
  /** The fallback group is always present (and stored first; the page lists it last). */
  layouts: StoredLayout[];
}

export const LAYOUTS_FILE_VERSION = 2;

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function emptyMatch(): LayoutMatch {
  return { game: null, sessions: [], carTypes: [], cars: [] };
}

/** A trimmed name of at most MAX_LAYOUT_NAME characters; undefined when empty or not a string. */
export function parseLayoutName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, MAX_LAYOUT_NAME).trim();
  return name === "" ? undefined : name;
}

/** Known values only, in the canonical order, without duplicates. */
function pickKnown<T extends string>(value: unknown, known: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  return known.filter((k) => value.includes(k));
}

/** Trimmed, non-empty, de-duplicated (ignoring case) car names, in the order given. */
export function parseCars(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cars: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim().slice(0, MAX_CAR_NAME).trim();
    if (name === "" || cars.some((c) => sameCarName(c, name))) continue;
    cars.push(name);
    if (cars.length >= MAX_LAYOUT_CARS) break;
  }
  return cars;
}

function parseGame(value: unknown): SimName | null {
  return LAYOUT_SIMS.find((s) => s === value) ?? null;
}

/** Car types are iRacing only: a Le Mans Ultimate group has none. */
function withoutLmuCarTypes(match: LayoutMatch): LayoutMatch {
  return match.game === "lmu" && match.carTypes.length > 0 ? { ...match, carTypes: [] } : match;
}

/**
 * Reads a group's conditions. Version 1 files had a `sims` list instead of `game`: one sim
 * becomes that game, none or both become "any".
 */
export function parseMatch(value: unknown): LayoutMatch {
  if (!isObj(value)) return emptyMatch();
  const legacySims = pickKnown(value["sims"], LAYOUT_SIMS);
  const game =
    "game" in value ? parseGame(value["game"]) : legacySims.length === 1 ? legacySims[0]! : null;
  return withoutLmuCarTypes({
    game,
    sessions: pickKnown(value["sessions"], LAYOUT_SESSION_TYPES),
    carTypes: pickKnown(value["carTypes"], CAR_TYPES),
    cars: parseCars(value["cars"]),
  });
}

/** Applies the parts of `patch` that are present (each one replaces that condition). */
export function patchMatch(current: LayoutMatch, patch: unknown): LayoutMatch {
  if (!isObj(patch)) return current;
  const parsed = parseMatch({ game: null, ...patch });
  return withoutLmuCarTypes({
    game: "game" in patch ? parsed.game : current.game,
    sessions: "sessions" in patch ? parsed.sessions : current.sessions,
    carTypes: "carTypes" in patch ? parsed.carTypes : current.carTypes,
    cars: "cars" in patch ? parsed.cars : current.cars,
  });
}

function parseEnabled(
  value: unknown,
  manifests: readonly OverlayManifest[],
): Record<string, boolean> {
  if (!isObj(value)) return {};
  const enabled: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(value)) {
    if (typeof on === "boolean" && manifestForInstance(id, manifests)) enabled[id] = on;
  }
  return enabled;
}

function parseStoredLayout(
  value: unknown,
  manifests: readonly OverlayManifest[],
): StoredLayout | undefined {
  if (!isObj(value)) return undefined;
  const id = value["id"];
  if (typeof id !== "string" || id === "") return undefined;
  const isDefault = id === DEFAULT_LAYOUT_ID;
  return {
    id,
    name: isDefault ? FALLBACK_GROUP_NAME : (parseLayoutName(value["name"]) ?? "Group"),
    // The fallback group is used when nothing else matches; it has no conditions.
    match: isDefault ? emptyMatch() : parseMatch(value["match"]),
    enabled: parseEnabled(value["enabled"], manifests),
    bounds: parseLayout(value["bounds"], manifests),
  };
}

/** The on/off state of every instance, as the overlay settings hold it now. */
export function enabledOf(
  settings: Record<string, OverlayInstanceSettings>,
): Record<string, boolean> {
  return Object.fromEntries(Object.entries(settings).map(([id, s]) => [id, s.enabled]));
}

/** Whether instance `id` is on in `layout`: switched on there and offered for the group's game. */
export function isOnIn(
  layout: Pick<StoredLayout, "enabled" | "match">,
  id: string,
  manifests: readonly OverlayManifest[],
): boolean {
  const manifest = manifestForInstance(id, manifests);
  return (
    layout.enabled[id] === true &&
    manifest !== undefined &&
    offeredForGame(manifest.sims, layout.match.game)
  );
}

/**
 * The two groups a user starts with, one per game, each a copy of `source` (positions and the
 * overlays that are on) with the overlays the game does not offer turned off.
 */
export function starterGroups(
  source: StoredLayout,
  manifests: readonly OverlayManifest[],
  ids: Iterable<string>,
): StoredLayout[] {
  const taken = new Set(ids);
  return LAYOUT_SIMS.map((game) => {
    const id = nextLayoutId(taken);
    taken.add(id);
    const match: LayoutMatch = { ...emptyMatch(), game };
    const enabled = Object.fromEntries(
      Object.keys(source.enabled).map((key) => [key, isOnIn({ ...source, match }, key, manifests)]),
    );
    return { id, name: SIM_LABELS[game], match, enabled, bounds: structuredClone(source.bounds) };
  });
}

/**
 * First run with groups: the single layout so far (layout.json) and the overlays that are on now
 * become the fallback group, which is active, plus one starter group per game. Automatic
 * switching starts on.
 */
export function migrateLayouts(
  bounds: Layout,
  settings: Record<string, OverlayInstanceSettings>,
  manifests: readonly OverlayManifest[],
): LayoutsFile {
  const fallback: StoredLayout = {
    id: DEFAULT_LAYOUT_ID,
    name: FALLBACK_GROUP_NAME,
    match: emptyMatch(),
    enabled: enabledOf(settings),
    bounds: structuredClone(bounds),
  };
  return {
    version: LAYOUTS_FILE_VERSION,
    activeId: DEFAULT_LAYOUT_ID,
    autoSwitch: true,
    layouts: [fallback, ...starterGroups(fallback, manifests, [DEFAULT_LAYOUT_ID])],
  };
}

/**
 * Reads layouts.json. Returns undefined when the file holds no layouts at all (missing or
 * unreadable: the caller migrates). Invalid layouts and duplicate ids are dropped; a missing
 * fallback group is rebuilt from `fallback`; an unknown active id falls back to it. A version 1
 * file that holds only the fallback gets the starter groups.
 */
export function parseLayoutsFile(
  raw: unknown,
  manifests: readonly OverlayManifest[],
  fallback: () => StoredLayout,
): LayoutsFile | undefined {
  if (!isObj(raw) || !Array.isArray(raw["layouts"])) return undefined;
  const layouts: StoredLayout[] = [];
  for (const item of raw["layouts"]) {
    const layout = parseStoredLayout(item, manifests);
    if (layout && !layouts.some((l) => l.id === layout.id)) layouts.push(layout);
  }
  const defaultIndex = layouts.findIndex((l) => l.id === DEFAULT_LAYOUT_ID);
  const def = (defaultIndex >= 0 ? layouts.splice(defaultIndex, 1)[0] : undefined) ?? fallback();
  layouts.unshift(def);
  if (raw["version"] !== LAYOUTS_FILE_VERSION && layouts.length === 1) {
    layouts.push(...starterGroups(def, manifests, [def.id]));
  }
  const activeId = raw["activeId"];
  return {
    version: LAYOUTS_FILE_VERSION,
    activeId:
      typeof activeId === "string" && layouts.some((l) => l.id === activeId)
        ? activeId
        : DEFAULT_LAYOUT_ID,
    autoSwitch: raw["autoSwitch"] !== false,
    layouts,
  };
}

/** The next free "layout-<n>" id. */
export function nextLayoutId(ids: Iterable<string>): string {
  const taken = new Set(ids);
  let n = 1;
  while (taken.has(`layout-${n}`)) n += 1;
  return `layout-${n}`;
}

/** "Group 1", "Group 2", ... : the first such name nobody uses yet. */
export function nextLayoutName(names: Iterable<string>, base = "Group"): string {
  const taken = new Set([...names].map((n) => n.toLowerCase()));
  let n = 1;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** "<name> copy", shortened so it fits the name limit. */
export function copyName(name: string): string {
  const suffix = " copy";
  return `${name.slice(0, MAX_LAYOUT_NAME - suffix.length).trim()}${suffix}`;
}

export function layoutView(layout: StoredLayout): LayoutView {
  return {
    id: layout.id,
    name: layout.name,
    isDefault: layout.id === DEFAULT_LAYOUT_ID,
    match: structuredClone(layout.match),
    enabled: { ...layout.enabled },
  };
}

export interface LayoutsStoreOptions {
  /** layouts.json. */
  file: string;
  manifests: readonly OverlayManifest[];
  /** The bounds from before layouts existed (layout.json), read on first run. */
  loadLegacyBounds(): Layout;
  /** Writes the active layout's bounds to layout.json too, so older versions still find them. */
  saveLegacyBounds?(bounds: Layout): void;
  /** The overlay settings as they are now (for the on/off states on first run). */
  currentSettings(): Record<string, OverlayInstanceSettings>;
}

/**
 * The saved layouts (layouts.json): which one is active, the automatic switch setting, and the
 * bounds and on/off states of each. Every change is written at once (atomically); bounds arrive
 * already debounced from the overlay manager.
 */
export class LayoutsStore {
  private data: LayoutsFile;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: LayoutsStoreOptions) {
    const migrate = (): LayoutsFile =>
      migrateLayouts(options.loadLegacyBounds(), options.currentSettings(), options.manifests);
    const fallback = (): StoredLayout => {
      const first = migrate().layouts[0];
      if (!first) throw new Error("migration made no fallback group");
      return first;
    };
    const raw = readJsonFile(options.file);
    const parsed = parseLayoutsFile(raw, options.manifests, fallback);
    this.data = parsed ?? migrate();
    if (!parsed || (raw as { version?: unknown }).version !== LAYOUTS_FILE_VERSION) this.write();
  }

  get activeId(): string {
    return this.data.activeId;
  }

  get autoSwitch(): boolean {
    return this.data.autoSwitch;
  }

  list(): readonly StoredLayout[] {
    return this.data.layouts;
  }

  get(id: string): StoredLayout | undefined {
    return this.data.layouts.find((l) => l.id === id);
  }

  active(): StoredLayout {
    const active = this.get(this.data.activeId) ?? this.data.layouts[0];
    if (!active) throw new Error("no layouts");
    return active;
  }

  /** The groups as the page lists them: the fallback group last. */
  views(): LayoutView[] {
    const views = this.data.layouts.map(layoutView);
    return [...views.filter((v) => !v.isDefault), ...views.filter((v) => v.isDefault)];
  }

  /** Whether instance `id` is on in group `layoutId` (offered for its game and switched on). */
  isOn(layoutId: string, id: string): boolean {
    const layout = this.get(layoutId);
    return layout !== undefined && isOnIn(layout, id, this.options.manifests);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Makes `id` the active layout (nothing else). Returns false for an unknown id. */
  setActive(id: string): boolean {
    if (!this.get(id)) return false;
    if (this.data.activeId === id) return true;
    this.data.activeId = id;
    this.commit();
    return true;
  }

  setAutoSwitch(on: boolean): void {
    if (this.data.autoSwitch === on) return;
    this.data.autoSwitch = on;
    this.commit();
  }

  /** A new layout that copies `sourceId` (bounds, on/off states, tags). Returns its id. */
  duplicate(sourceId: string, name?: string): string | undefined {
    const source = this.get(sourceId);
    if (!source) return undefined;
    const id = nextLayoutId(this.data.layouts.map((l) => l.id));
    const isDefault = source.id === DEFAULT_LAYOUT_ID;
    this.data.layouts.push({
      id,
      name:
        parseLayoutName(name) ??
        (isDefault ? nextLayoutName(this.data.layouts.map((l) => l.name)) : copyName(source.name)),
      match: structuredClone(source.match),
      enabled: { ...source.enabled },
      bounds: structuredClone(source.bounds),
    });
    this.commit();
    return id;
  }

  /** A new group that copies the active one, with a fresh name and no conditions. */
  createFromActive(): string | undefined {
    const id = this.duplicate(
      this.data.activeId,
      nextLayoutName(this.data.layouts.map((l) => l.name)),
    );
    const created = id === undefined ? undefined : this.get(id);
    if (created) {
      created.match = emptyMatch();
      this.commit();
    }
    return id;
  }

  /** Renames a group (not the fallback). Returns false when nothing changed. */
  rename(id: string, name: unknown): boolean {
    const layout = this.get(id);
    const next = parseLayoutName(name);
    if (!layout || id === DEFAULT_LAYOUT_ID || next === undefined || next === layout.name) {
      return false;
    }
    layout.name = next;
    this.commit();
    return true;
  }

  /** Deletes a group (never the fallback). The caller switches away first when it is the active one. */
  remove(id: string): boolean {
    if (id === DEFAULT_LAYOUT_ID || id === this.data.activeId) return false;
    const index = this.data.layouts.findIndex((l) => l.id === id);
    if (index < 0) return false;
    this.data.layouts.splice(index, 1);
    this.commit();
    return true;
  }

  /** Changes a group's conditions (not the fallback's); each one present in `patch` replaces the old one. */
  setMatch(id: string, patch: unknown): boolean {
    const layout = this.get(id);
    if (!layout || id === DEFAULT_LAYOUT_ID) return false;
    const next = patchMatch(layout.match, patch);
    if (JSON.stringify(next) === JSON.stringify(layout.match)) return false;
    layout.match = next;
    this.commit();
    return true;
  }

  /** The overlay manager's saves land here: the active layout's bounds. */
  saveActiveBounds(bounds: Layout): void {
    const active = this.active();
    active.bounds = structuredClone(bounds);
    this.write();
    try {
      this.options.saveLegacyBounds?.(bounds);
    } catch (error) {
      console.error("Could not save layout.json", error);
    }
  }

  /** An instance was turned on or off: the active group remembers it. */
  setEnabled(instanceId: string, on: boolean): void {
    this.setEnabledIn(this.data.activeId, instanceId, on);
  }

  /** Turns an instance on or off in one group (no windows change here). */
  setEnabledIn(layoutId: string, instanceId: string, on: boolean): boolean {
    const layout = this.get(layoutId);
    if (!layout || !manifestForInstance(instanceId, this.options.manifests)) return false;
    if (layout.enabled[instanceId] === on) return true;
    layout.enabled[instanceId] = on;
    this.commit();
    return true;
  }

  /** Records every instance's current on/off state in the active layout (at start). */
  captureEnabled(settings: Record<string, OverlayInstanceSettings>): void {
    const active = this.active();
    const next = { ...active.enabled };
    for (const [id, on] of Object.entries(enabledOf(settings))) {
      // An overlay the group's game does not offer keeps its stored state (it is off here anyway).
      const manifest = manifestForInstance(id, this.options.manifests);
      if (manifest && offeredForGame(manifest.sims, active.match.game)) next[id] = on;
    }
    if (JSON.stringify(next) === JSON.stringify(active.enabled)) return;
    active.enabled = next;
    this.commit();
  }

  /** An added instance was removed: every layout forgets it. */
  forgetInstance(instanceId: string): void {
    let changed = false;
    for (const layout of this.data.layouts) {
      if (instanceId in layout.enabled || instanceId in layout.bounds) {
        delete layout.enabled[instanceId];
        delete layout.bounds[instanceId];
        changed = true;
      }
    }
    if (changed) this.commit();
  }

  private commit(): void {
    this.write();
    for (const listener of this.listeners) listener();
  }

  private write(): void {
    try {
      writeJsonFileAtomic(this.options.file, this.data);
    } catch (error) {
      console.error("Could not save layouts", error);
    }
  }
}
