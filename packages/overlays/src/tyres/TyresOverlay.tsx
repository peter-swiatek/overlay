import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString } from "../settings";
import "./tyres.css";
import {
  CORNERS,
  compoundFamily,
  compoundText,
  SAMPLE_TYRES_VIEW,
  tempBand,
  tempsLeftToRight,
  treadBand,
  tyresView,
  type CornerId,
  type TempWindow,
  type TyreCornerView,
} from "./view";

const NO_VALUE = "--";
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;

const LABEL: Readonly<Record<CornerId, string>> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };

export type PressureUnit = "kpa" | "bar" | "psi";

/** "auto" follows Settings > General > Units: kPa when metric, psi when imperial. */
export function pressureUnit(option: string, prefs: DisplayPrefs): PressureUnit {
  if (option === "kpa" || option === "bar" || option === "psi") return option;
  return prefs.units === "imperial" ? "psi" : "kpa";
}

/** "172 kPa", "1.72 bar", "24.9 psi"; "-- kPa" when unknown. */
export function pressureText(kpa: number | null, unit: PressureUnit): string {
  if (kpa === null) return `${NO_VALUE} ${unit === "kpa" ? "kPa" : unit}`;
  if (unit === "bar") return `${(kpa / KPA_PER_BAR).toFixed(2)} bar`;
  if (unit === "psi") return `${(kpa / KPA_PER_PSI).toFixed(1)} psi`;
  return `${Math.round(kpa)} kPa`;
}

/** Whole degrees, Fahrenheit with imperial units: "91°"; "--" when unknown. */
export function degreesText(celsius: number | null, prefs: DisplayPrefs): string {
  if (celsius === null) return NO_VALUE;
  const value = prefs.units === "imperial" ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°`;
}

interface CardOptions {
  layer: boolean;
  window: TempWindow;
  treadWarn: number;
  treadCritical: number;
  pressure: PressureUnit;
  brakes: boolean;
  prefs: DisplayPrefs;
}

function Card({ id, c, o }: { id: CornerId; c: TyreCornerView; o: CardOptions }) {
  const temps = (o.layer ? c.innerLayer : null) ?? c.surface;
  const band = tempBand(temps, o.window);
  const tread = treadBand(c.tread, o.treadWarn, o.treadCritical);
  return (
    <div className="ty-card" data-corner={id}>
      <div className="ty-card-head">
        <span className="ty-corner">{LABEL[id]}</span>
        <span className={`ty-tread ty-tread--${tread}`}>
          {c.tread === null ? NO_VALUE : `${Math.round(c.tread * 100)}%`}
        </span>
      </div>
      <div className={`ty-temps ty-temps--${band}`}>
        {tempsLeftToRight(id, temps).map((t, i) => (
          <span key={i}>{degreesText(t, o.prefs)}</span>
        ))}
      </div>
      <div className="ty-card-foot">
        <span>{pressureText(c.pressureKpa, o.pressure)}</span>
        {o.brakes ? <span>Brk {degreesText(c.brakeC, o.prefs)}</span> : null}
      </div>
    </div>
  );
}

export function TyresOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing, prefs } = useOverlayRuntime();
  const live = useTelemetry(tyresView, 5);
  const view = live ?? (editing ? SAMPLE_TYRES_VIEW : null);
  if (view === null) return <></>;

  const options: CardOptions = {
    layer: optionString(settings, "temp-source") !== "surface",
    window: {
      coldBelowC: optionNumber(settings, "temp-cold"),
      hotAboveC: optionNumber(settings, "temp-hot"),
      overheatAboveC: optionNumber(settings, "temp-overheat"),
    },
    treadWarn: optionNumber(settings, "tread-warn"),
    treadCritical: optionNumber(settings, "tread-critical"),
    pressure: pressureUnit(optionString(settings, "pressure-unit"), prefs),
    brakes: optionBoolean(settings, "show-brakes"),
    prefs,
  };
  const pill = optionBoolean(settings, "show-compound") ? compoundText(view) : null;
  const family = compoundFamily(view.frontCompound ?? view.rearCompound);

  return (
    <div className="ty">
      <div className="ty-head">
        <span className="ty-title">4-CORNER TYRES</span>
        {pill === null ? null : <span className={`ty-pill ty-pill--${family}`}>{pill}</span>}
      </div>
      <div className="ty-grid">
        {CORNERS.map((id) => (
          <Card key={id} id={id} c={view.corners[id]} o={options} />
        ))}
      </div>
    </div>
  );
}
