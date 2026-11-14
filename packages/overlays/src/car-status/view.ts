import type { TelemetryFrame, WheelValues } from "@overlay/sim-core/types";
import {
  SAMPLE_DAMAGE_VIEW,
  damageView,
  type DamageView,
  type Severity,
  type Zones,
} from "../vehicle-damage/view";
import {
  CORNERS,
  tempBand,
  tyresView,
  type CornerId,
  type TempBand,
  type TempWindow,
  type TyreCornerView,
} from "../tyres/view";

export { CORNERS, type CornerId };

/** Everything the panel shows; each part null when the sim does not give it. */
export interface CarStatusView {
  /** Tyres, pressures, tread and brakes per corner. */
  tyres: Readonly<Record<CornerId, TyreCornerView>> | null;
  /** Dent zones and flat tyres. */
  damage: DamageView | null;
  /** Aero damage 0..1; LMU REST only. */
  aero: number | null;
  /** Suspension damage 0..1 per corner; LMU REST only. */
  suspension: WheelValues | null;
  waterC: number | null;
  oilC: number | null;
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

/** The player's car; null without a live frame or with nothing to show. */
export function carStatusView(frame: TelemetryFrame | null): CarStatusView | null {
  if (frame === null || frame.status !== "live") return null;
  const p = frame.state.player;
  const tyres = tyresView(frame)?.corners ?? null;
  const damage = damageView(frame);
  const susp = p.damage?.suspension ?? null;
  const view: CarStatusView = {
    tyres,
    damage,
    aero: num(p.damage?.aero),
    suspension: susp === null ? null : { ...susp },
    waterC: num(p.waterTempC),
    oilC: num(p.oilTempC),
  };
  const empty = tyres === null && damage === null && view.waterC === null && view.oilC === null;
  return empty ? null : view;
}

/** Below this a damage fraction counts as none (it rounds to 0.0 %). */
const DAMAGE_NONE_BELOW = 0.0005;
/** From here a damage fraction counts as heavy: our threshold, the sim names no levels. */
export const DAMAGE_HEAVY_FROM = 0.1;

/** A REST damage fraction as a severity; null when unknown. */
export function fractionSeverity(v: number | null): Severity | null {
  if (v === null) return null;
  if (v < DAMAGE_NONE_BELOW) return "ok";
  return v < DAMAGE_HEAVY_FROM ? "minor" : "heavy";
}

/** The average across the tyre (outer, middle, inner), with its colour band. */
export function tyreTemp(
  c: TyreCornerView,
  underTread: boolean,
  window: TempWindow,
): { c: number | null; band: TempBand } {
  const temps = (underTread ? c.innerLayer : null) ?? c.surface;
  const known = [temps.inner, temps.middle, temps.outer].filter((v): v is number => v !== null);
  const mean = known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length;
  return { c: mean, band: tempBand(temps, window) };
}

/** "3.0%"; one decimal so a light knock does not read as zero. */
export function damagePctText(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const NO_DENTS: Zones = SAMPLE_DAMAGE_VIEW.zones;

const sampleCorner = (
  temp: number,
  pressureKpa: number,
  tread: number,
  brakeC: number,
): TyreCornerView => {
  const temps = { inner: temp + 2, middle: temp, outer: temp - 2 };
  return { tread, surface: temps, innerLayer: temps, pressureKpa, brakeC, compound: "Medium" };
};

/** Shown in edit mode without live data: a mid-stint car with a scuffed left front and right side. */
export const SAMPLE_CAR_STATUS_VIEW: CarStatusView = {
  tyres: {
    fl: sampleCorner(86, 172, 0.74, 412),
    fr: sampleCorner(91, 173, 0.68, 436),
    rl: sampleCorner(82, 168, 0.77, 355),
    rr: sampleCorner(88, 169, 0.72, 371),
  },
  damage: {
    zones: { ...NO_DENTS, front: "ok", frontLeft: "minor", right: "minor" },
    tyreFlat: { fl: false, fr: false, rl: false, rr: false },
    sinceImpactS: 42,
  },
  aero: 0.06,
  suspension: { fl: 0, fr: 0.03, rl: 0, rr: 0 },
  waterC: 88,
  oilC: 104,
};
