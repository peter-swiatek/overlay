import { formatDriverName, formatLapTime, formatVolume } from "@overlay/ui/format";
import type { DisplayPrefs, NameFormat } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString } from "../settings";
import "./lap-times.css";
import { lapTimesView, SAMPLE_LAP_TIMES_VIEW, type LapRow, type LapTimesView } from "./view";

const NO_VALUE = "--";
/** Lap times use three decimals (owner preference; the design shows two). */
const LAP_DECIMALS = 3;

type ColumnId = "lap" | "lap-time" | "delta" | "track" | "fuel";

interface Column {
  id: ColumnId;
  label: string;
  /** CSS grid track. */
  width: string;
  align: "center" | "left" | "right";
  cell: (row: LapRow) => JSX.Element | string;
}

const NAME_FORMATS: readonly NameFormat[] = [
  "full",
  "f-last",
  "first-l",
  "last",
  "first",
  "last-f",
];

/** "+0.33" / "-0.15" / "0.00"; "--" without both times. */
export function deltaText(delta: number | null): string {
  if (delta === null) return NO_VALUE;
  const text = Math.abs(delta).toFixed(2);
  if (delta > 0) return `+${text}`;
  return delta < 0 ? `-${text}` : text;
}

/** "31.0°" (converted to Fahrenheit with imperial units); "--" when unknown. */
export function temperatureText(celsius: number | null, prefs: DisplayPrefs): string {
  if (celsius === null || !Number.isFinite(celsius)) return NO_VALUE;
  const value = prefs.units === "imperial" ? (celsius * 9) / 5 + 32 : celsius;
  return `${value.toFixed(1)}°`;
}

/** "2.40 L" / "0.63 gal"; "--" when unknown. */
export function fuelText(litres: number | null, prefs: DisplayPrefs): string {
  if (litres === null) return NO_VALUE;
  const m = formatVolume(litres, prefs, 2);
  return `${m.value} ${m.unit}`;
}

function columns(prefs: DisplayPrefs): Column[] {
  return [
    {
      id: "lap",
      label: "Lap",
      width: "3.1em",
      align: "center",
      cell: (row) => String(row.lapNumber),
    },
    {
      id: "lap-time",
      label: "Lap Time",
      width: "minmax(5.6em, 1fr)",
      align: "left",
      cell: (row) => (
        <>
          <span className={row.best ? "lt-time lt-fastest" : "lt-time"}>
            {formatLapTime(row.lapTimeS, LAP_DECIMALS)}
          </span>
          {row.pit ? <span className="lt-tag">PIT</span> : null}
        </>
      ),
    },
    {
      id: "delta",
      label: "Delta",
      width: "4.6em",
      align: "right",
      cell: (row) => (
        <span className={row.deltaTone === null ? undefined : `lt-${row.deltaTone}`}>
          {deltaText(row.deltaS)}
        </span>
      ),
    },
    {
      id: "track",
      label: "Track",
      width: "4em",
      align: "right",
      cell: (row) => temperatureText(row.trackTempC, prefs),
    },
    {
      id: "fuel",
      label: "Fuel",
      width: "4.4em",
      align: "right",
      cell: (row) => fuelText(row.fuelUsedL, prefs),
    },
  ];
}

function rowClass(row: LapRow, index: number): string {
  const classes = ["lt-row"];
  if (index % 2 === 0) classes.push("lt-row--alt");
  if (index === 0) classes.push("lt-row--newest");
  if (!row.valid) classes.push("lt-row--invalid");
  return classes.join(" ");
}

function LapTable({ view, shown }: { view: LapTimesView; shown: readonly Column[] }) {
  if (shown.length === 0) return null;
  const template = shown.map((c) => c.width).join(" ");
  return (
    <div className="lt-table" style={{ gridTemplateColumns: template }}>
      <div className="lt-row lt-row--header">
        {shown.map((c) => (
          <div key={c.id} className={`lt-cell lt-cell--${c.align}`}>
            {c.label}
          </div>
        ))}
      </div>
      {view.rows.length === 0 ? (
        <div className="lt-row lt-row--alt">
          <div className="lt-cell lt-empty" style={{ gridColumn: "1 / -1" }}>
            No completed laps yet
          </div>
        </div>
      ) : (
        view.rows.map((row, i) => (
          <div key={row.lapNumber} className={rowClass(row, i)} data-lap={row.lapNumber}>
            {shown.map((c) => (
              <div key={c.id} className={`lt-cell lt-cell--${c.align}`} data-col={c.id}>
                {c.cell(row)}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function SessionBest({ view }: { view: LapTimesView }) {
  return (
    <div className="lt-session-best">
      <div className="lt-sb-main">
        <span className="lt-sb-label">SESSION BEST</span>
        <span className="lt-sb-time">{formatLapTime(view.bestLapS, LAP_DECIMALS)}</span>
      </div>
      <div className="lt-sb-side">
        <span className="lt-sb-label">LAP</span>
        <span className="lt-sb-lap">
          {view.bestLapNumber === null ? NO_VALUE : String(view.bestLapNumber)}
        </span>
      </div>
    </div>
  );
}

function Item({ label, value, fastest }: { label: string; value: string; fastest?: boolean }) {
  return (
    <span className="lt-item">
      <span className="lt-label">{label}</span>
      <span className={fastest ? "lt-value lt-fastest" : "lt-value"}>{value}</span>
    </span>
  );
}

export function LapTimesOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing } = useOverlayRuntime();
  const rows = optionNumber(settings, "rows");
  const live = useTelemetry((frame) => lapTimesView(frame, { rows }), 5);
  const view = live ?? (editing ? SAMPLE_LAP_TIMES_VIEW : null);

  if (view === null) {
    return (
      <div className="lt">
        <div className="lt-waiting">Waiting for laps</div>
      </div>
    );
  }

  const format = optionString(settings, "name-format") as NameFormat;
  const name = formatDriverName(view.driverName, NAME_FORMATS.includes(format) ? format : "f-last");
  const driver = [view.carNumber, name].filter((s) => s !== null && s !== "").join(" ");
  const stint =
    view.stintLaps === null
      ? NO_VALUE
      : `${view.stintLaps} ${view.stintLaps === 1 ? "Lap" : "Laps"}`;
  const shown = columns(prefs).filter((c) => optionBoolean(settings, `col-${c.id}`));

  return (
    <div className="lt">
      {optionBoolean(settings, "show-top-bar") ? (
        <div className="lt-strip lt-strip--top">
          <Item label="Driver" value={driver || NO_VALUE} />
          <Item label="Stint" value={stint} />
        </div>
      ) : null}
      {optionBoolean(settings, "show-session-best") ? <SessionBest view={view} /> : null}
      <LapTable view={view} shown={shown} />
      {optionBoolean(settings, "show-footer") ? (
        <div className="lt-strip lt-strip--footer">
          <Item label="Avg (5L)" value={formatLapTime(view.avgLapS, LAP_DECIMALS)} />
          <Item label="Avg (10L)" value={formatLapTime(view.avg10LapS, LAP_DECIMALS)} />
          <Item label="Opt" value={formatLapTime(view.optimalLapS, LAP_DECIMALS)} />
        </div>
      ) : null}
    </div>
  );
}
