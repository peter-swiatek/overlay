import type { TelemetryFrame } from "@overlay/sim-core/types";

/** ok: nothing; minor: the sim's lowest dent level (1); heavy: anything above it. */
export type Severity = "ok" | "minor" | "heavy";

export type WheelId = "fl" | "fr" | "rl" | "rr";

export const WHEELS: readonly WheelId[] = ["fl", "fr", "rl", "rr"];

/**
 * The eight body zones in the sim's order, going round the car from the nose through the left
 * side (see `VehicleDamage.dents`).
 */
export type ZoneId =
  "front" | "frontLeft" | "left" | "rearLeft" | "rear" | "rearRight" | "right" | "frontRight";

export const ZONES: readonly ZoneId[] = [
  "front",
  "frontLeft",
  "left",
  "rearLeft",
  "rear",
  "rearRight",
  "right",
  "frontRight",
];

export type Zones = Readonly<Record<ZoneId, Severity>>;

export interface DamageView {
  zones: Zones;
  tyreFlat: Readonly<Record<WheelId, boolean>>;
  /** Seconds since the last impact; null when there was none (or the clock is unknown). */
  sinceImpactS: number | null;
}

/** A body area for the status pill and the details: three zones each, the corners shared. */
export type Area = "front" | "rear" | "side";

const AREA_ZONES: Readonly<Record<Area, readonly ZoneId[]>> = {
  front: ["frontLeft", "front", "frontRight"],
  rear: ["rearLeft", "rear", "rearRight"],
  side: ["left", "right"],
};

const RANK: Readonly<Record<Severity, number>> = { ok: 0, minor: 1, heavy: 2 };

/**
 * The sim's dent value as a severity: 0 ok, 1 minor, 2 and up heavy. LMU writes 0 to 2 (only 0
 * and 2 were seen in the recordings); anything that is not a positive number counts as ok.
 */
export function severityOf(dent: number): Severity {
  if (!Number.isFinite(dent) || dent < 1) return "ok";
  return dent < 2 ? "minor" : "heavy";
}

export function worst(list: readonly Severity[]): Severity {
  return list.reduce<Severity>((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
}

/** The worst severity over an area's zones. */
export function areaSeverity(zones: Zones, area: Area): Severity {
  return worst(AREA_ZONES[area].map((z) => zones[z]));
}

/** The player's damage; null without a live frame or damage data (iRacing gives none). */
export function damageView(frame: TelemetryFrame | null): DamageView | null {
  if (frame === null || frame.status !== "live") return null;
  const damage = frame.state.player.damage;
  if (damage === null || damage === undefined) return null;
  const zones = Object.fromEntries(
    ZONES.map((id, i) => [id, severityOf(damage.dents[i] ?? 0)]),
  ) as Record<ZoneId, Severity>;
  const now = frame.state.tickTimeS;
  const at = damage.lastImpactS;
  return {
    zones,
    tyreFlat: { ...damage.tyreFlat },
    sinceImpactS: at === null || now === null ? null : Math.max(0, now - at),
  };
}

export interface DamageStatus {
  text: string;
  tone: Severity;
}

/**
 * The header pill, from the zones and tyres alone:
 *
 * - nothing damaged: "NO DAMAGE" (ok);
 * - a flat tyre: "FLAT TYRE" ("FLAT TYRES" for more than one), heavy; with heavy body damage
 *   as well, "HEAVY DAMAGE";
 * - otherwise the worst dent level and where the dents are: "MINOR FRONT", "HEAVY REAR",
 *   "MINOR SIDE", or "... BODY" when they are in more than one area. A dent on a corner zone
 *   (front left, say) counts as front or rear, not side.
 */
export function damageStatus(view: DamageView): DamageStatus {
  const level = worst(ZONES.map((z) => view.zones[z]));
  const flats = WHEELS.filter((w) => view.tyreFlat[w]).length;
  if (flats > 0) {
    if (level === "heavy") return { text: "HEAVY DAMAGE", tone: "heavy" };
    return { text: flats > 1 ? "FLAT TYRES" : "FLAT TYRE", tone: "heavy" };
  }
  if (level === "ok") return { text: "NO DAMAGE", tone: "ok" };
  const areas = (["front", "rear", "side"] as const).filter(
    (a) => areaSeverity(view.zones, a) !== "ok",
  );
  const [only] = areas;
  const where = areas.length === 1 && only !== undefined ? only.toUpperCase() : "BODY";
  return { text: `${level === "heavy" ? "HEAVY" : "MINOR"} ${where}`, tone: level };
}

/** True when nothing is dented and no tyre is flat. */
export function isClean(view: DamageView): boolean {
  return damageStatus(view).text === "NO DAMAGE";
}

/** "12 s ago", "3 min ago"; "--" when there was no hit. */
export function sinceText(seconds: number | null): string {
  if (seconds === null) return "--";
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

/** "OK", "RL flat", "FL RL flat". */
export function tyresText(flat: Readonly<Record<WheelId, boolean>>): string {
  const names = WHEELS.filter((w) => flat[w]).map((w) => w.toUpperCase());
  return names.length === 0 ? "OK" : `${names.join(" ")} flat`;
}

/** Shown in edit mode without live data: the design's light knock to the nose. */
export const SAMPLE_DAMAGE_VIEW: DamageView = {
  zones: {
    front: "minor",
    frontLeft: "ok",
    left: "ok",
    rearLeft: "ok",
    rear: "ok",
    rearRight: "ok",
    right: "ok",
    frontRight: "ok",
  },
  tyreFlat: { fl: false, fr: false, rl: false, rr: false },
  sinceImpactS: 42,
};
