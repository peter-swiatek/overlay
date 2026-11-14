import type { IncidentAhead, IncidentAheadKind, TelemetryFrame } from "@overlay/sim-core/types";

/*
 * Incident Bar view model. The incident comes from sim-core (Derived.incidentAhead): the nearest
 * car ahead that is slow or stopped on track, or (iRacing) off track, within 1000 m. The overlay
 * narrows that to its own range and picks the colour.
 */

export interface IncidentBarOptions {
  /** Show incidents up to this far ahead, metres. */
  rangeM: number;
  /** A stopped car this close or closer turns the bar red, metres. */
  redDistanceM: number;
  cornerLabels: boolean;
}

/** "yellow": slow, off track, or stopped further away; "red": stopped close ahead. */
export type IncidentBarTone = "yellow" | "red";

export interface IncidentBarView {
  /** "▲ INCIDENT AHEAD · 180 m (3 OFF T7) ▲". */
  text: string;
  tone: IncidentBarTone;
  /** Width of each side's fill, percent of the bar: grows as the distance shrinks. */
  fillPct: number;
}

export const KIND_LABEL: Readonly<Record<IncidentAheadKind, string>> = {
  off: "OFF",
  slow: "SLOW",
  stopped: "STOPPED",
};

/** Each side's fill at the edge of the range, and how much it grows on the way in, percent. */
const FILL_MIN_PCT = 20;
const FILL_GROWTH_PCT = 40;
/** The two fills meet in the middle. */
const FILL_MAX_PCT = 50;

/** Each side's fill for a car `distanceM` ahead, percent: 20 at the range, 50 from 25% of it in. */
export function fillPct(distanceM: number, rangeM: number): number {
  const closeness = rangeM > 0 ? 1 - Math.min(1, Math.max(0, distanceM / rangeM)) : 1;
  return Math.round(Math.min(FILL_MAX_PCT, FILL_MIN_PCT + FILL_GROWTH_PCT * closeness));
}

/** "3 OFF T7": car number (no "#"), what it is doing, and the corner when known and wanted. */
export function incidentDetail(
  incident: Pick<IncidentAhead, "carNumber" | "kind" | "corner">,
  cornerLabels: boolean,
): string {
  const corner = cornerLabels && incident.corner !== null ? `T${incident.corner}` : null;
  return [incident.carNumber, KIND_LABEL[incident.kind], corner]
    .filter((s) => s !== null && s !== "")
    .join(" ");
}

export function incidentBarText(distanceM: number, detail: string): string {
  return `▲ INCIDENT AHEAD · ${Math.round(distanceM)} m (${detail}) ▲`;
}

export function incidentView(
  incident: IncidentAhead,
  options: IncidentBarOptions,
): IncidentBarView {
  const red = incident.stopped && incident.distanceM <= options.redDistanceM;
  return {
    text: incidentBarText(incident.distanceM, incidentDetail(incident, options.cornerLabels)),
    tone: red ? "red" : "yellow",
    fillPct: fillPct(incident.distanceM, options.rangeM),
  };
}

/** Null without a live frame or without an incident within range. */
export function incidentBarView(
  frame: TelemetryFrame | null,
  options: IncidentBarOptions,
): IncidentBarView | null {
  if (frame === null || frame.status !== "live") return null;
  const incident = frame.derived.incidentAhead;
  if (incident === null || incident.distanceM > options.rangeM) return null;
  return incidentView(incident, options);
}

/** An invented incident, shown in edit mode while there is none so the bar can be placed. */
const SAMPLE: IncidentAhead = {
  carIdx: 2,
  carNumber: "3",
  distanceM: 180,
  kind: "off",
  stopped: false,
  corner: 7,
};

export function sampleIncidentBarView(options: IncidentBarOptions): IncidentBarView {
  return incidentView(SAMPLE, options);
}
