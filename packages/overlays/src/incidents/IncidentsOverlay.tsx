import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean } from "../settings";
import "./incidents.css";
import {
  incidentBar,
  incidentsView,
  SAMPLE_INCIDENTS_VIEW,
  type IncidentStatus,
  type IncidentsView,
} from "./view";

export const STATUS_LABEL: Readonly<Record<IncidentStatus, string>> = {
  clean: "CLEAN",
  caution: "CAUTION",
  penalty: "PENALTY",
  dq: "DQ",
};

function Bar({ view }: { view: IncidentsView }) {
  const segments = incidentBar(view);
  if (segments.length === 0) return null;
  return (
    <div className="inc-bar">
      {segments.map((s) => (
        <div
          key={s.kind}
          className={`inc-track inc-track--${s.kind}`}
          style={{ flexGrow: s.share }}
          data-segment={s.kind}
        >
          <div className="inc-fill" style={{ width: `${(s.fill * 100).toFixed(1)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function IncidentsOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const live = useTelemetry(incidentsView, 5);
  const view = live ?? (editing ? SAMPLE_INCIDENTS_VIEW : null);
  if (view === null) return <></>;

  const limits = optionBoolean(settings, "show-limits");
  const bar = optionBoolean(settings, "show-bar");
  const hasLimits = view.penaltyLimit !== null || view.dqLimit !== null;

  return (
    <div className={`inc inc--${view.status}`}>
      <div className="inc-head">
        <span className="inc-title">{view.team ? "TEAM INC" : "INCIDENTS"}</span>
        <span className={`inc-pill inc-pill--${view.status}`}>{STATUS_LABEL[view.status]}</span>
      </div>
      <div className="inc-body">
        <span className="inc-count">
          <span className="inc-num">{view.count}</span>
          <span className="inc-x">x</span>
        </span>
        {limits && hasLimits ? (
          <span className="inc-limits">
            {view.penaltyLimit !== null ? (
              <span className="inc-limit">
                <span className="inc-limit-label">Pen:</span>{" "}
                <span className="inc-limit-value">{view.penaltyLimit}x</span>
              </span>
            ) : null}
            {view.dqLimit !== null ? (
              <span className="inc-limit">
                <span className="inc-limit-label">DQ:</span>{" "}
                <span className="inc-limit-value inc-limit-value--dq">{view.dqLimit}x</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {bar ? <Bar view={view} /> : null}
    </div>
  );
}
