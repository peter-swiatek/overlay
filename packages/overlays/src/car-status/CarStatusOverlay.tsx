import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString } from "../settings";
import {
  degreesText,
  NO_VALUE,
  pressureText,
  pressureUnit,
  type PressureUnit,
} from "../tyres/units";
import type { TempWindow } from "../tyres/view";
import type { Severity, ZoneId } from "../vehicle-damage/view";
import "./car-status.css";
import { SEGMENTS, VIEW_H, VIEW_W, WHEELS } from "./shape";
import {
  brakeBand,
  carStatusView,
  CORNERS,
  damagePctText,
  fractionSeverity,
  SAMPLE_CAR_STATUS_VIEW,
  tyreTemp,
  type CarStatusView,
  type CornerId,
} from "./view";

/** "86°C" or "187°F"; "--" when unknown. */
export function tempText(celsius: number | null, prefs: DisplayPrefs): string {
  if (celsius === null) return NO_VALUE;
  return `${degreesText(celsius, prefs)}${prefs.units === "imperial" ? "F" : "C"}`;
}

interface Options {
  rows: { temp: boolean; pressure: boolean; tread: boolean; suspension: boolean; brake: boolean };
  engine: boolean;
  aero: boolean;
  underTread: boolean;
  window: TempWindow;
  pressure: PressureUnit;
  prefs: DisplayPrefs;
}

function Car({ view, o }: { view: CarStatusView; o: Options }) {
  const zones = view.damage?.zones ?? null;
  const zoneClass = (z: ZoneId): Severity | "unknown" => (zones === null ? "unknown" : zones[z]);
  return (
    <svg className="cs-car" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
      {SEGMENTS.map((s, i) => (
        <path
          key={i}
          className={`cs-seg cs-seg--${zoneClass(s.zone)}`}
          data-zone={s.zone}
          d={s.d}
        />
      ))}
      {CORNERS.map((id) => {
        const w = WHEELS[id];
        const tyre = view.tyres?.[id];
        const band = tyre === undefined ? "unknown" : tyreTemp(tyre, o.underTread, o.window).band;
        const flat = view.damage?.tyreFlat[id] === true;
        const susp = fractionSeverity(view.suspension?.[id] ?? null) ?? "unknown";
        const brake = brakeBand(tyre?.brakeC ?? null);
        // From the body outward: suspension, brake, tyre.
        return (
          <g key={id} data-wheel={id}>
            <path className={`cs-chev cs-chev--${susp}`} data-part="suspension" d={w.chevron} />
            <rect
              className={`cs-brake cs-brake--${brake}`}
              data-part="brake"
              {...w.brake}
              rx="1.5"
            />
            <rect
              className={flat ? "cs-tyre cs-tyre--flat" : `cs-tyre cs-tyre--${band}`}
              data-part="tyre"
              {...w.tyre}
              rx="4"
            />
          </g>
        );
      })}
    </svg>
  );
}

function EngineIcon() {
  return (
    <svg className="cs-icon cs-icon--engine" viewBox="0 0 32 24" aria-hidden="true">
      <path d="M9,5 H17 M13,5 V8 M6,8 H20 L23,11 H26 V9 H29 V19 H26 V17 H23 L20,20 H9 L6,17 H3 V11 H6 Z" />
    </svg>
  );
}

function OilIcon() {
  return (
    <svg className="cs-icon" viewBox="0 0 24 16" aria-hidden="true">
      <path d="M2,6 L7,8 H10 L12,6 H15 L22,4 L17,12 H7 V8 M10,6 V4 H13" />
    </svg>
  );
}

function WaterIcon() {
  return (
    <svg className="cs-icon" viewBox="0 0 24 16" aria-hidden="true">
      <path d="M8,2 V11 M6,13 A2.5,2.5 0 1 0 10,13 M6,13 V3 A2,2 0 0 1 10,3 V13 M13,5 H17 M13,8 H17 M13,11 Q15,13 17,11 T21,11" />
    </svg>
  );
}

function Centre({ view, o }: { view: CarStatusView; o: Options }) {
  const engine = o.engine && (view.oilC !== null || view.waterC !== null);
  const aero = o.aero ? view.aero : null;
  if (!engine && aero === null) return null;
  return (
    <div className="cs-centre">
      {engine ? (
        <>
          <span className="cs-engine-temp" data-value="oil">
            <OilIcon />
            {tempText(view.oilC, o.prefs)}
          </span>
          <EngineIcon />
          <span className="cs-engine-temp" data-value="water">
            <WaterIcon />
            {tempText(view.waterC, o.prefs)}
          </span>
        </>
      ) : null}
      {aero === null ? null : (
        <span className={`cs-aero cs-aero--${fractionSeverity(aero) ?? "ok"}`}>
          <small>AERO</small>
          {Math.round(aero * 100)}%
        </span>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="cs-row">
      <span className="cs-label">{label}</span>
      <b className={tone === undefined ? "cs-val" : `cs-val cs-val--${tone}`}>{value}</b>
    </div>
  );
}

function Corner({ id, view, o }: { id: CornerId; view: CarStatusView; o: Options }) {
  const tyre = view.tyres?.[id] ?? null;
  const susp = view.suspension?.[id] ?? null;
  const r = o.rows;
  return (
    <div className="cs-corner" data-corner={id}>
      {r.temp ? (
        <Row
          label="TYRE"
          value={tempText(tyre === null ? null : tyreTemp(tyre, o.underTread, o.window).c, o.prefs)}
        />
      ) : null}
      {r.pressure ? (
        <Row label="PRESS" value={pressureText(tyre?.pressureKpa ?? null, o.pressure)} />
      ) : null}
      {r.tread ? (
        <Row
          label="TREAD"
          value={
            tyre === null || tyre.tread === null ? NO_VALUE : `${Math.round(tyre.tread * 100)}%`
          }
        />
      ) : null}
      {/* Only while the game's repair screen answers: no row rather than a made-up value. */}
      {r.suspension && view.suspension !== null && susp !== null ? (
        <Row label="SUSP" value={damagePctText(susp)} tone={fractionSeverity(susp) ?? "ok"} />
      ) : null}
      {r.brake ? <Row label="BRAKE" value={tempText(tyre?.brakeC ?? null, o.prefs)} /> : null}
    </div>
  );
}

/** Damage, tyres and temperatures: the car from above between two columns of corner values. */
export function CarStatusOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing, prefs } = useOverlayRuntime();
  const live = useTelemetry(carStatusView, 5);
  const view = live ?? (editing ? SAMPLE_CAR_STATUS_VIEW : null);
  if (view === null) return <></>;

  const o: Options = {
    rows: {
      temp: optionBoolean(settings, "show-temp"),
      pressure: optionBoolean(settings, "show-pressure"),
      tread: optionBoolean(settings, "show-tread"),
      suspension: optionBoolean(settings, "show-suspension"),
      brake: optionBoolean(settings, "show-brake"),
    },
    engine: optionBoolean(settings, "show-engine"),
    aero: optionBoolean(settings, "show-aero"),
    underTread: optionString(settings, "temp-source") !== "surface",
    window: {
      coldBelowC: optionNumber(settings, "temp-cold"),
      hotAboveC: optionNumber(settings, "temp-hot"),
      overheatAboveC: optionNumber(settings, "temp-overheat"),
    },
    pressure: pressureUnit(optionString(settings, "pressure-unit"), prefs),
    prefs,
  };

  return (
    <div className="cs">
      <div className="cs-side cs-side--left">
        <Corner id="fl" view={view} o={o} />
        <Corner id="rl" view={view} o={o} />
      </div>
      <div className="cs-stage">
        <Car view={view} o={o} />
        <Centre view={view} o={o} />
      </div>
      <div className="cs-side cs-side--right">
        <Corner id="fr" view={view} o={o} />
        <Corner id="rr" view={view} o={o} />
      </div>
    </div>
  );
}
