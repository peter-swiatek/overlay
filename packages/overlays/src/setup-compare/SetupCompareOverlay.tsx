import { formatLapTime, formatSpeed, formatVolume } from "@overlay/ui/format";
import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean } from "../settings";
import "./setup-compare.css";
import {
  sampleSetupCompareView,
  setupCompareView,
  type CompareRow,
  type SetupCompareOptions,
  type SetupCompareView,
} from "./view";

const NO_VALUE = "--";
/** Lap and sector times use three decimals (owner preference; the design shows two). */
const TIME_DECIMALS = 3;

/** "-0.360 s" / "+0.050 s" / "0.000 s"; "--" without a delta. */
export function deltaText(deltaS: number | null): string {
  if (deltaS === null) return NO_VALUE;
  const text = Math.abs(deltaS).toFixed(TIME_DECIMALS);
  if (deltaS > 0) return `+${text} s`;
  return deltaS < 0 ? `-${text} s` : `${text} s`;
}

function signed(value: string): string {
  if (/^-?0(\.0+)?$/.test(value)) return value.replace(/^-/, "");
  return value.startsWith("-") ? value : `+${value}`;
}

/** "+3.4 km/h" (mph with imperial units); "--" without a delta. */
export function topSpeedText(deltaMps: number | null, prefs: DisplayPrefs): string {
  if (deltaMps === null) return NO_VALUE;
  const m = formatSpeed(deltaMps, prefs, 1);
  return `${signed(m.value)} ${m.unit}`;
}

/** Tone of a top speed delta as shown (one decimal): faster is a gain. */
export function topSpeedTone(deltaMps: number | null, prefs: DisplayPrefs): "gain" | "loss" | null {
  if (deltaMps === null) return null;
  const shown = Number(formatSpeed(deltaMps, prefs, 1).value);
  return shown > 0 ? "gain" : shown < 0 ? "loss" : null;
}

/** "2.38 L (-0.02)"; without a baseline "2.38 L"; "--" without the active setup's use. */
export function fuelText(view: SetupCompareView, prefs: DisplayPrefs): string {
  if (view.fuelPerLapL === null) return NO_VALUE;
  const m = formatVolume(view.fuelPerLapL, prefs, 2);
  const value = `${m.value} ${m.unit}`;
  if (view.fuelDeltaL === null) return value;
  return `${value} (${signed(formatVolume(view.fuelDeltaL, prefs, 2).value)})`;
}

function rowClass(index: number): string {
  return index % 2 === 0 ? "sc-row sc-row--alt" : "sc-row";
}

function Table({ view }: { view: SetupCompareView }) {
  return (
    <div className="sc-table">
      <div className="sc-row sc-row--header">
        <div className="sc-cell">Metric</div>
        <div className="sc-cell sc-cell--right">Baseline</div>
        <div className="sc-cell sc-cell--right">Active</div>
        <div className="sc-cell sc-cell--right">Delta</div>
      </div>
      {view.rows.map((row: CompareRow, i) => (
        <div key={row.id} className={rowClass(i)} data-row={row.id}>
          <div className="sc-cell sc-label">{row.label}</div>
          <div className="sc-cell sc-cell--right">
            {formatLapTime(row.baselineS, TIME_DECIMALS)}
          </div>
          <div className={`sc-cell sc-cell--right${row.activeFastest ? " sc-fastest" : ""}`}>
            {formatLapTime(row.activeS, TIME_DECIMALS)}
          </div>
          <div className={`sc-cell sc-cell--right${row.tone === null ? "" : ` sc-${row.tone}`}`}>
            {deltaText(row.deltaS)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SetupCompareOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing } = useOverlayRuntime();
  const options: SetupCompareOptions = { sectors: optionBoolean(settings, "show-sectors") };
  const live = useTelemetry((frame) => setupCompareView(frame, options), 5);
  const view = live ?? (editing ? sampleSetupCompareView(options) : null);

  if (view === null) {
    return (
      <div className="sc">
        <div className="sc-waiting">Waiting for a car setup</div>
      </div>
    );
  }

  const speedTone = topSpeedTone(view.topSpeedDeltaMps, prefs);
  return (
    <div className="sc">
      <div className="sc-strip sc-strip--top">
        <span className="sc-item">
          <span className="sc-label-muted">{view.pinned ? "Pinned" : "Base"}</span>
          <span className="sc-value">{view.baselineName}</span>
        </span>
        <span className="sc-item">
          <span className="sc-label-muted">Active</span>
          <span className="sc-value sc-active">{view.activeName}</span>
        </span>
      </div>
      <Table view={view} />
      {optionBoolean(settings, "show-footer") ? (
        <div className="sc-strip sc-strip--footer">
          <span className="sc-item">
            <span className="sc-label-muted">Top Speed</span>
            <span className={`sc-value${speedTone === null ? "" : ` sc-${speedTone}`}`}>
              {topSpeedText(view.topSpeedDeltaMps, prefs)}
            </span>
          </span>
          <span className="sc-item">
            <span className="sc-label-muted">Fuel/Lap</span>
            <span className="sc-value">{fuelText(view, prefs)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
