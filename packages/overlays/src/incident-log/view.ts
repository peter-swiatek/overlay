import type { IncidentLogEvent, IncidentLogKind, TelemetryFrame } from "@overlay/sim-core/types";
import { formatDriverName } from "@overlay/ui/format";
import type { NameFormat } from "@overlay/ui/types";
import { incidentLimits } from "../incidents/view";

/*
 * Incident Log view model. Events come from sim-core's incident log (Derived.incidentLog): the
 * player's incident points where the sim counts them (iRacing), and every car's off-track
 * excursions from its track surface. Rows are plain zebra rows: the log does not mark the
 * player's own row.
 */

/** The newest row is highlighted for this long after its event, session seconds. */
export const HIGHLIGHT_S = 6;

const NO_VALUE = "--";

/** "neutral": 0x; "warn": 1x; "loss": 2x and more; "none": no points (off-tracks, LMU). */
export type PointsTone = "neutral" | "warn" | "loss" | "none";

export interface IncidentLogOptions {
  /** Include other cars' events; off lists only the player's. */
  fieldEvents: boolean;
  cornerLabels: boolean;
  highlightNewest: boolean;
  rows: number;
  nameFormat: NameFormat;
}

export interface IncidentLogRow {
  id: number;
  time: string;
  lap: string;
  sector: string;
  /** "12 M. Example · Off track (T7)". */
  text: string;
  points: string;
  tone: PointsTone;
  highlight: boolean;
}

export interface IncidentLogView {
  /** The player's name in the chosen format; null when unknown. */
  driverName: string | null;
  /** The player's own incident count; null where the sim has none (LMU). */
  ownCount: number | null;
  fieldEvents: boolean;
  penaltyLimit: number | null;
  dqLimit: number | null;
  /** Newest first. */
  rows: IncidentLogRow[];
}

export const KIND_LABEL: Readonly<Record<IncidentLogKind, string>> = {
  "off-track": "Off track",
  "loss-of-control": "Loss of control",
  contact: "Contact",
  incident: "Incident",
};

/** Session time as "04:05" under an hour, "1:02:03" from an hour on. */
export function sessionClock(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function pointsTone(points: number | null): PointsTone {
  if (points === null) return "none";
  if (points <= 0) return "neutral";
  return points === 1 ? "warn" : "loss";
}

export function eventText(
  e: IncidentLogEvent,
  options: Pick<IncidentLogOptions, "cornerLabels" | "nameFormat">,
): string {
  const name = e.driverName === null ? "" : formatDriverName(e.driverName, options.nameFormat);
  const who = [e.carNumber, name].filter((s) => s !== null && s !== "").join(" ");
  const corner = options.cornerLabels && e.corner !== null ? ` (T${e.corner})` : "";
  const what = `${KIND_LABEL[e.kind]}${corner}`;
  return who === "" ? what : `${who} · ${what}`;
}

export function eventRows(
  events: readonly IncidentLogEvent[],
  options: IncidentLogOptions,
  nowS: number | null,
): IncidentLogRow[] {
  const shown = (options.fieldEvents ? events : events.filter((e) => e.own)).slice(
    0,
    Math.max(0, options.rows),
  );
  return shown.map((e, i) => ({
    id: e.id,
    time: sessionClock(e.timeS),
    lap: e.lap === null ? NO_VALUE : String(e.lap),
    sector: e.sector === null ? NO_VALUE : `S${e.sector}`,
    text: eventText(e, options),
    points: e.points === null ? NO_VALUE : `${e.points}x`,
    tone: pointsTone(e.points),
    highlight:
      options.highlightNewest &&
      i === 0 &&
      nowS !== null &&
      nowS >= e.timeS &&
      nowS - e.timeS < HIGHLIGHT_S,
  }));
}

/** Null without a live frame. */
export function incidentLogView(
  frame: TelemetryFrame | null,
  options: IncidentLogOptions,
): IncidentLogView | null {
  if (frame === null || frame.status !== "live") return null;
  const { state } = frame;
  const player = state.cars.find((c) => c.carIdx === state.playerCarIdx);
  const raw = state.player.incidentCount;
  const { penaltyLimit, dqLimit } = incidentLimits(state.session);
  const name = player?.driverName ?? null;
  return {
    driverName: name === null ? null : formatDriverName(name, options.nameFormat),
    ownCount: raw === null || !Number.isFinite(raw) ? null : Math.max(0, Math.round(raw)),
    fieldEvents: options.fieldEvents,
    penaltyLimit,
    dqLimit,
    rows: eventRows(frame.derived.incidentLog?.events ?? [], options, state.tickTimeS),
  };
}

/** Invented sample events, shown in edit mode while there is no data so the layout can be placed. */
const SAMPLE_EVENTS: readonly IncidentLogEvent[] = [
  sample(5, 1491, 15, 2, "3", "Sam Example", "off-track", null, 7),
  sample(4, 1478, 15, 1, "8", "Kim Sample", "off-track", null, 4),
  sample(3, 1152, 12, 1, "1", "Alex Placeholder", "contact", 4, null),
  sample(2, 845, 9, 3, "20", "Jo Testcase", "off-track", null, null),
  sample(1, 226, 3, 2, "1", "Alex Placeholder", "loss-of-control", 2, 2),
];

function sample(
  id: number,
  timeS: number,
  lap: number,
  sector: number,
  carNumber: string,
  driverName: string,
  kind: IncidentLogKind,
  points: number | null,
  corner: number | null,
): IncidentLogEvent {
  const own = carNumber === "1";
  return {
    id,
    carIdx: Number(carNumber),
    carNumber,
    driverName,
    timeS,
    lap,
    sector,
    corner,
    kind,
    points,
    own,
  };
}

export function sampleIncidentLogView(options: IncidentLogOptions): IncidentLogView {
  return {
    driverName: formatDriverName("Alex Placeholder", options.nameFormat),
    ownCount: 6,
    fieldEvents: options.fieldEvents,
    penaltyLimit: 17,
    dqLimit: 25,
    rows: eventRows(SAMPLE_EVENTS, { ...options, highlightNewest: false }, null),
  };
}
