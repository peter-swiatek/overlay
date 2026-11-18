import type { NameFormat } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString } from "../settings";
import "./incident-log.css";
import {
  incidentLogView,
  sampleIncidentLogView,
  type IncidentLogOptions,
  type IncidentLogRow,
  type IncidentLogView,
} from "./view";

const NAME_FORMATS: readonly NameFormat[] = [
  "full",
  "f-last",
  "first-l",
  "last",
  "first",
  "last-f",
];

const NO_VALUE = "--";

/** "6x (A. Example) · Field Events": the player's count and name, then which events are listed. */
export function sessionLogText(view: IncidentLogView): string {
  const count = view.ownCount === null ? null : `${view.ownCount}x`;
  const name = view.driverName === null || view.driverName === "" ? null : view.driverName;
  const who = count !== null && name !== null ? `${count} (${name})` : (count ?? name ?? NO_VALUE);
  return `${who} · ${view.fieldEvents ? "Field Events" : "Own Events"}`;
}

/** "17x / 25x"; a limit the session does not set reads "--"; null when it sets neither. */
export function limitText(view: IncidentLogView): string | null {
  const { penaltyLimit: pen, dqLimit: dq } = view;
  if (pen === null && dq === null) return null;
  const x = (n: number | null) => (n === null ? NO_VALUE : `${n}x`);
  return `${x(pen)} / ${x(dq)}`;
}

function rowClass(row: IncidentLogRow, index: number): string {
  const classes = ["il-row"];
  if (index % 2 === 1) classes.push("il-row--alt");
  if (row.highlight) classes.push("il-row--new");
  return classes.join(" ");
}

function Table({ view }: { view: IncidentLogView }) {
  return (
    <div className="il-table">
      <div className="il-row il-row--header">
        <div className="il-cell">Time</div>
        <div className="il-cell il-cell--center">Lap</div>
        <div className="il-cell il-cell--center">Sec</div>
        <div className="il-cell">Incident Type</div>
        <div className="il-cell il-cell--right">Pts</div>
      </div>
      {view.rows.length === 0 ? (
        <div className="il-row">
          <div className="il-cell il-empty" style={{ gridColumn: "1 / -1" }}>
            No incidents yet
          </div>
        </div>
      ) : (
        view.rows.map((row, i) => (
          <div key={row.id} className={rowClass(row, i)} data-event={row.id}>
            <div className="il-cell">{row.time}</div>
            <div className="il-cell il-cell--center">{row.lap}</div>
            <div className="il-cell il-cell--center">{row.sector}</div>
            <div className="il-cell il-cell--text">
              <span className="il-text">{row.text}</span>
            </div>
            <div className={`il-cell il-cell--right il-pts il-pts--${row.tone}`}>{row.points}</div>
          </div>
        ))
      )}
    </div>
  );
}

export function IncidentLogOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const format = optionString(settings, "name-format") as NameFormat;
  const options: IncidentLogOptions = {
    fieldEvents: optionBoolean(settings, "field-events"),
    cornerLabels: optionBoolean(settings, "corner-labels"),
    highlightNewest: optionBoolean(settings, "highlight-newest"),
    rows: optionNumber(settings, "rows"),
    nameFormat: NAME_FORMATS.includes(format) ? format : "f-last",
  };
  const live = useTelemetry((frame) => incidentLogView(frame, options), 5);
  const view = live ?? (editing ? sampleIncidentLogView(options) : null);

  if (view === null) {
    return (
      <div className="il">
        <div className="il-waiting">Waiting for session</div>
      </div>
    );
  }

  const limits = limitText(view);
  const n = view.rows.length;
  return (
    <div className="il">
      <div className="il-strip il-strip--top">
        <span className="il-item">
          <span className="il-label">Session Log</span>
          <span className="il-value">{sessionLogText(view)}</span>
        </span>
        {limits === null ? null : (
          <span className="il-item il-item--fixed">
            <span className="il-label">Limit</span>
            <span className="il-value">{limits}</span>
          </span>
        )}
      </div>
      <Table view={view} />
      <div className="il-strip il-strip--footer">
        <span className="il-item">
          Newest on top · Showing {n} {n === 1 ? "record" : "records"}
        </span>
      </div>
    </div>
  );
}
