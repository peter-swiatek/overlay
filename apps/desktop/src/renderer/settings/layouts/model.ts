import {
  LAYOUT_SESSION_TYPES,
  LAYOUT_SIMS,
  SESSION_TYPE_LABELS,
  SIM_LABELS,
  type LayoutMatch,
  type LayoutView,
  type SimContext,
} from "../../../shared/layout-types";

/** One line on when a layout is used, e.g. "iRacing · Qualifying, Race · 2 cars". */
export function tagsSummary(layout: Pick<LayoutView, "isDefault" | "match">): string {
  if (layout.isDefault) return "Used when no other layout matches";
  const { sims, sessions, cars } = layout.match;
  const parts: string[] = [];
  if (sims.length > 0) parts.push(sims.map((s) => SIM_LABELS[s]).join(", "));
  if (sessions.length > 0) parts.push(sessions.map((s) => SESSION_TYPE_LABELS[s]).join(", "));
  if (cars.length === 1 && cars[0] !== undefined) parts.push(cars[0]);
  else if (cars.length > 1) parts.push(`${cars.length} cars`);
  return parts.length > 0 ? parts.join(" · ") : "No tags: any sim, session and car";
}

export function overlayCountLabel(count: number): string {
  if (count === 0) return "No overlays";
  return count === 1 ? "1 overlay" : `${count} overlays`;
}

/** The current context in words, for the top of the page. */
export function contextLabels(context: SimContext): { sim: string; car: string; session: string } {
  return {
    sim: context.sim === null ? "Not connected" : SIM_LABELS[context.sim],
    car: context.carName ?? "Unknown",
    session: context.sessionType === null ? "Unknown" : SESSION_TYPE_LABELS[context.sessionType],
  };
}

/** Adds or removes `value` from a list, keeping the canonical order of `all`. */
export function toggleIn<T extends string>(list: readonly T[], value: T, all: readonly T[]): T[] {
  const on = !list.includes(value);
  return all.filter((v) => (v === value ? on : list.includes(v)));
}

export function toggleSim(
  match: LayoutMatch,
  sim: LayoutMatch["sims"][number],
): LayoutMatch["sims"] {
  return toggleIn(match.sims, sim, LAYOUT_SIMS);
}

export function toggleSession(
  match: LayoutMatch,
  session: LayoutMatch["sessions"][number],
): LayoutMatch["sessions"] {
  return toggleIn(match.sessions, session, LAYOUT_SESSION_TYPES);
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
