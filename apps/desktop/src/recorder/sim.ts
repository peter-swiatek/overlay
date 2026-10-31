import type { SimSource, SimState } from "@overlay/sim-core";

/**
 * The sim a recording belongs to, decided in one place. A replay says `source: "replay"`, so its
 * sim is read off what the state carries: only LMU has virtual energy, only iRacing has incident
 * counts, iRatings and licences. Use the state's own sim field here once it has one.
 */
export function recordingSim(source: SimSource, state: SimState): string {
  if (source !== "replay") return source;
  if (state.player.energyFraction !== null) return "lmu";
  const iracing =
    state.player.incidentCount !== null ||
    state.cars.some((c) => c.iRating !== null || c.license !== null);
  return iracing ? "iracing" : "replay";
}
