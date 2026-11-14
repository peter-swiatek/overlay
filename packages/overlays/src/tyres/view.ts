import type { TelemetryFrame, TyreCorner, TyreTemps } from "@overlay/sim-core/types";

export type CornerId = "fl" | "fr" | "rl" | "rr";

/** Grid order: front left, front right, rear left, rear right. */
export const CORNERS: readonly CornerId[] = ["fl", "fr", "rl", "rr"];

export interface TyreCornerView {
  /** Tread left, 0..1 (1 = new); null when unknown. */
  tread: number | null;
  surface: TyreTemps;
  /** Under the tread; null when the sim gives none. */
  innerLayer: TyreTemps | null;
  pressureKpa: number | null;
  brakeC: number | null;
  /** The sim's name of the compound on this tyre; null when unknown. */
  compound: string | null;
}

export interface TyresView {
  /** Laps completed on the set; null when unknown. */
  lapsOnSet: number | null;
  corners: Readonly<Record<CornerId, TyreCornerView>>;
}

/** Compound families, each with its own locked pill colour. */
export type CompoundFamily = "soft" | "medium" | "hard" | "inter" | "wet" | "other";

/** cold: below the window; ok: in it; hot: above it; overheat: well above it. */
export type TempBand = "cold" | "ok" | "hot" | "overheat" | "unknown";

/** warn and critical: tread below the yellow and red limits. */
export type TreadBand = "ok" | "warn" | "critical" | "unknown";

export interface TempWindow {
  coldBelowC: number;
  hotAboveC: number;
  overheatAboveC: number;
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

/** `axle` is the axle's compound, for states without one per wheel. */
function corner(c: TyreCorner, axle: string | null | undefined): TyreCornerView {
  const layer = c.innerLayerTemps ?? null;
  return {
    tread:
      c.wear === null || !Number.isFinite(c.wear) ? null : Math.min(1, Math.max(0, 1 - c.wear)),
    surface: { inner: num(c.temps.inner), middle: num(c.temps.middle), outer: num(c.temps.outer) },
    innerLayer:
      layer === null
        ? null
        : { inner: num(layer.inner), middle: num(layer.middle), outer: num(layer.outer) },
    pressureKpa: num(c.pressureKpa),
    brakeC: num(c.brakeTempC),
    compound: c.compound ?? axle ?? null,
  };
}

/** The player's tyres; null without a live frame or tyre data. */
export function tyresView(frame: TelemetryFrame | null): TyresView | null {
  if (frame === null || frame.status !== "live") return null;
  const t = frame.state.player.tyres;
  if (t === null) return null;
  const front = t.frontCompound;
  const rear = t.rearCompound;
  return {
    lapsOnSet: frame.derived.tyreStint?.lapsOnSet ?? null,
    corners: {
      fl: corner(t.fl, front),
      fr: corner(t.fr, front),
      rl: corner(t.rl, rear),
      rr: corner(t.rr, rear),
    },
  };
}

const sampleCorner = (
  tread: number,
  [inner, middle, outer]: readonly [number, number, number],
  pressureKpa: number,
  brakeC: number,
): TyreCornerView => {
  const temps = { inner, middle, outer };
  return { tread, surface: temps, innerLayer: temps, pressureKpa, brakeC, compound: "Medium" };
};

/** Shown in edit mode without live data: the design's mid-stint Medium set. */
export const SAMPLE_TYRES_VIEW: TyresView = {
  lapsOnSet: 15,
  corners: {
    fl: sampleCorner(0.93, [94, 91, 87], 172, 490),
    fr: sampleCorner(0.91, [96, 93, 89], 174, 510),
    rl: sampleCorner(0.95, [90, 88, 85], 169, 420),
    rr: sampleCorner(0.94, [91, 89, 86], 170, 430),
  },
};

/**
 * The three temperatures as the tyre sits on the car seen from above: the left-hand tyres read
 * outer, middle, inner from left to right and the right-hand tyres inner, middle, outer, so the
 * car's centre line runs between the two columns.
 */
export function tempsLeftToRight(
  id: CornerId,
  t: TyreTemps,
): [number | null, number | null, number | null] {
  return id === "fl" || id === "rl" ? [t.outer, t.middle, t.inner] : [t.inner, t.middle, t.outer];
}

/** Overheat and hot go by the hottest point, cold by the average across the tyre. */
export function tempBand(t: TyreTemps, w: TempWindow): TempBand {
  const known = [t.inner, t.middle, t.outer].filter((v): v is number => v !== null);
  if (known.length === 0) return "unknown";
  const max = Math.max(...known);
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  if (max > w.overheatAboveC) return "overheat";
  if (max > w.hotAboveC) return "hot";
  return mean < w.coldBelowC ? "cold" : "ok";
}

/** Limits are percentages of tread left. */
export function treadBand(tread: number | null, warnPct: number, criticalPct: number): TreadBand {
  if (tread === null) return "unknown";
  const pct = tread * 100;
  if (pct < criticalPct) return "critical";
  return pct < warnPct ? "warn" : "ok";
}

/** The family of a sim compound name; "other" when the name says none of them. */
export function compoundFamily(name: string | null): CompoundFamily {
  const n = (name ?? "").toLowerCase();
  if (n.includes("inter")) return "inter";
  if (n.includes("wet") || n.includes("rain")) return "wet";
  if (n.includes("soft")) return "soft";
  if (n.includes("medium")) return "medium";
  if (n.includes("hard")) return "hard";
  return "other";
}

/** S, M, H, I or W for the tyre's compound family; "?" for a name in none of them. */
export function compoundInitial(name: string): string {
  const initial: Readonly<Record<CompoundFamily, string>> = {
    soft: "S",
    medium: "M",
    hard: "H",
    inter: "I",
    wet: "W",
    other: "?",
  };
  return initial[compoundFamily(name)];
}

export interface CompoundPill {
  text: string;
  family: CompoundFamily;
}

/**
 * The header pill: "MEDIUM · L15" when all four tyres match, "MIXED · L15" in the neutral colour
 * when they differ. Without the compound on each tyre (`perTyre` false) a set that differs only
 * front to rear reads "SOFT / MEDIUM · L3" in the front's colour instead. "L4" alone when no
 * compound is known; null when there is nothing to say.
 */
export function compoundPill(view: TyresView, perTyre: boolean): CompoundPill | null {
  const { fl, fr, rl, rr } = view.corners;
  const known = [fl, fr, rl, rr].map((c) => c.compound).filter((n): n is string => n !== null);
  const distinct = [...new Set(known)];
  const front = fl.compound ?? fr.compound;
  const rear = rl.compound ?? rr.compound;
  const byAxle =
    !perTyre && fl.compound === fr.compound && rl.compound === rr.compound && front !== rear;
  let names: string | null = distinct[0] ?? null;
  let family = compoundFamily(names);
  if (distinct.length > 1) {
    names = byAxle ? `${front} / ${rear}` : "Mixed";
    family = byAxle ? compoundFamily(front) : "other";
  }
  const { lapsOnSet } = view;
  const parts = [names?.toUpperCase() ?? null, lapsOnSet === null ? null : `L${lapsOnSet}`];
  const text = parts.filter((p) => p !== null).join(" · ");
  return text === "" ? null : { text, family };
}
