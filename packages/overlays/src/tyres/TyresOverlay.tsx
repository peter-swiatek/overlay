import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString } from "../settings";
import "./tyres.css";
import { degreesText, NO_VALUE, pressureText, pressureUnit, type PressureUnit } from "./units";
import {
  CORNERS,
  compoundFamily,
  compoundInitial,
  compoundPill,
  SAMPLE_TYRES_VIEW,
  tempBand,
  tempsLeftToRight,
  treadBand,
  tyresView,
  type CornerId,
  type TempWindow,
  type TyreCornerView,
} from "./view";

const LABEL: Readonly<Record<CornerId, string>> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };

interface CardOptions {
  layer: boolean;
  window: TempWindow;
  treadWarn: number;
  treadCritical: number;
  pressure: PressureUnit;
  brakes: boolean;
  /** A compound badge next to the corner label. */
  compound: boolean;
  prefs: DisplayPrefs;
}

/** The tyre's compound initial in its family colour; nothing when the compound is unknown. */
function CompoundBadge({ name }: { name: string | null }) {
  if (name === null) return null;
  return (
    <span className={`ty-cmp ty-cmp--${compoundFamily(name)}`} title={name}>
      {compoundInitial(name)}
    </span>
  );
}

function Card({ id, c, o }: { id: CornerId; c: TyreCornerView; o: CardOptions }) {
  const temps = (o.layer ? c.innerLayer : null) ?? c.surface;
  const band = tempBand(temps, o.window);
  const tread = treadBand(c.tread, o.treadWarn, o.treadCritical);
  return (
    <div className="ty-card" data-corner={id}>
      <div className="ty-card-head">
        <span className="ty-corner">
          {LABEL[id]}
          {o.compound ? <CompoundBadge name={c.compound} /> : null}
        </span>
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
    compound: optionBoolean(settings, "show-tyre-compound"),
    prefs,
  };
  const pill = optionBoolean(settings, "show-compound")
    ? compoundPill(view, options.compound)
    : null;

  return (
    <div className="ty">
      <div className="ty-head">
        <span className="ty-title">4-CORNER TYRES</span>
        {pill === null ? null : (
          <span className={`ty-pill ty-pill--${pill.family}`}>{pill.text}</span>
        )}
      </div>
      <div className="ty-grid">
        {CORNERS.map((id) => (
          <Card key={id} id={id} c={view.corners[id]} o={options} />
        ))}
      </div>
    </div>
  );
}
