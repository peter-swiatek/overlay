import type { CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber } from "../settings";
import "./incident-bar.css";
import { incidentBarView, sampleIncidentBarView, type IncidentBarOptions } from "./view";

export function IncidentBarOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const options: IncidentBarOptions = {
    rangeM: optionNumber(settings, "range"),
    redDistanceM: optionNumber(settings, "red-distance"),
    cornerLabels: optionBoolean(settings, "corner-labels"),
  };
  const live = useTelemetry((frame) => incidentBarView(frame, options), 10);
  const view = live ?? (editing ? sampleIncidentBarView(options) : null);
  if (view === null) return <></>;
  return (
    <div
      className={`ib ib--${view.tone}`}
      style={{ "--ib-fill": `${view.fillPct}%` } as CSSProperties}
    >
      <div className="ib-fill ib-fill--left" />
      <div className="ib-fill ib-fill--right" />
      <span className="ib-label">{view.text}</span>
    </div>
  );
}
