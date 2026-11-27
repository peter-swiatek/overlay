import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { instanceNumber, instanceTitle, manifestForInstance } from "@overlay/overlays/instances";
import type { SimName } from "@overlay/sim-core/types";
import {
  CAR_TYPE_LABELS,
  SESSION_TYPE_LABELS,
  SIM_LABELS,
  offeredForGame,
  type SimContext,
} from "../../../shared/layout-types";

/** One overlay window a group can switch on: an overlay or one of its extra copies. */
export interface GroupOverlay {
  /** Instance id ("relative", "relative:2"). */
  id: string;
  title: string;
  sims: readonly SimName[];
}

/**
 * Every overlay instance with its title, in manifest order then by copy number. Developer-only
 * overlays are listed only while developer tools are on.
 */
export function groupOverlays(
  manifests: readonly OverlayManifest[],
  settings: Record<string, OverlayInstanceSettings>,
  developerEnabled: boolean,
): GroupOverlay[] {
  const order = (id: string): number =>
    manifests.findIndex((m) => m.id === manifestForInstance(id, manifests)?.id);
  return Object.entries(settings)
    .flatMap(([id, s]): GroupOverlay[] => {
      const manifest = manifestForInstance(id, manifests);
      if (!manifest || (manifest.dev === true && !developerEnabled)) return [];
      return [{ id, title: instanceTitle(manifest, id, s.name), sims: manifest.sims }];
    })
    .sort((a, b) => order(a.id) - order(b.id) || instanceNumber(a.id) - instanceNumber(b.id));
}

/** The overlays a group for `game` offers (each overlay's own list of sims decides). */
export function overlaysForGame(
  overlays: readonly GroupOverlay[],
  game: SimName | null,
): GroupOverlay[] {
  return overlays.filter((o) => offeredForGame(o.sims, game));
}

/** How many of the offered overlays are on in a group. */
export function countOn(
  offered: readonly GroupOverlay[],
  enabled: Record<string, boolean>,
): number {
  return offered.filter((o) => enabled[o.id] === true).length;
}

/** The current context in words, for the top of the page. */
export function contextLabels(context: SimContext): {
  game: string;
  car: string;
  carType: string;
  session: string;
} {
  const sim = context.sim === null ? null : SIM_LABELS[context.sim];
  let game = sim ?? "Not connected";
  if (context.testData) game = sim === null ? "Test data" : `Test data (${sim})`;
  return {
    game,
    car: context.carName ?? "Unknown",
    carType:
      context.carType !== null
        ? CAR_TYPE_LABELS[context.carType]
        : context.sim === "lmu"
          ? "Not used in Le Mans Ultimate"
          : "Unknown",
    session: context.sessionType === null ? "Unknown" : SESSION_TYPE_LABELS[context.sessionType],
  };
}

/** Adds or removes `value` from a list, keeping the canonical order of `all`. */
export function toggleIn<T extends string>(list: readonly T[], value: T, all: readonly T[]): T[] {
  const on = !list.includes(value);
  return all.filter((v) => (v === value ? on : list.includes(v)));
}

/** True when the list already holds the car (case and surrounding spaces ignored). */
export function hasCar(cars: readonly string[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return cars.some((c) => c.trim().toLowerCase() === wanted);
}

/** The list with `name` added at the end; unchanged for an empty name or one already there. */
export function addCar(cars: readonly string[], name: string): string[] {
  const trimmed = name.trim();
  if (trimmed === "" || hasCar(cars, trimmed)) return [...cars];
  return [...cars, trimmed];
}
