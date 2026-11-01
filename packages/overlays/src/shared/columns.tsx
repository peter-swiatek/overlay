import {
  ClassBadge,
  IRatingPill,
  LicencePill,
  PositionDelta,
  readableTextColour,
  type TableColumn,
} from "@overlay/ui";
import {
  formatDelta,
  formatGap,
  formatLapTime,
  formatNameDisplay,
  formatPercent,
} from "@overlay/ui/format";
import type { Decimals, DisplayPrefs, NameDisplay, NameFormat } from "@overlay/ui/types";
import type { CSSProperties, ReactNode } from "react";
import { DRIVER_FIELDS, DRIVER_FIELD_IDS, type DriverFieldId } from "./fields";
import type { DriverRow } from "./rows";
import "./driver-table.css";

export interface DriverColumnContext {
  prefs: DisplayPrefs;
  nameDisplay: NameDisplay;
  nameFormat: NameFormat;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
  /** runtime.combinedLicencePill */
  combinedLicencePill: boolean;
  /** "standings": gap = gap to the class leader with formatGap; "relative": gap = relativeGapS with formatDelta. */
  gapMode: "standings" | "relative";
}

const NONE = "--";

function count(value: number | null): string {
  return value === null ? NONE : String(value);
}

/** Colour by the sign of the already rounded value: gain, loss, or muted for zero. */
function deltaStyle(value: number | null): CSSProperties | undefined {
  if (value === null) return undefined;
  if (value < 0) return { color: "var(--ov-locked-gain)" };
  if (value > 0) return { color: "var(--ov-locked-loss)" };
  return { color: "var(--ov-text-muted)" };
}

function lapCell(value: number | null, decimals: Decimals, fastest = false): ReactNode {
  const text = formatLapTime(value, decimals);
  return fastest && value !== null ? (
    <span style={{ color: "var(--ov-locked-fastest)" }}>{text}</span>
  ) : (
    text
  );
}

function carNumberCell(row: DriverRow): ReactNode {
  if (row.carNumber === null) return NONE;
  const style: CSSProperties = {
    background: "var(--ov-class-colour, var(--ov-header))",
    color: row.classColour ? readableTextColour(row.classColour) : "var(--ov-text)",
  };
  return (
    <span className="ov-driver-number" style={style}>
      #{row.carNumber}
    </span>
  );
}

type Align = "left" | "center" | "right";

interface Layout {
  chars: number;
  /** Narrowest the column may get; defaults to `chars`. */
  minChars?: number;
  align?: Align;
  grow?: boolean;
}

const LAYOUT: Record<DriverFieldId, Layout> = {
  position: { chars: 3, align: "center" },
  "overall-position": { chars: 3, align: "center" },
  "car-number": { chars: 4, align: "center" },
  "car-class": { chars: 6, align: "center" },
  driver: { chars: 18, minChars: 10, align: "left", grow: true },
  licence: { chars: 6, align: "center" },
  irating: { chars: 6, align: "center" },
  gap: { chars: 6, align: "right" },
  interval: { chars: 6, align: "right" },
  "last-lap": { chars: 8, align: "right" },
  "best-lap": { chars: 8, align: "right" },
  "avg-lap": { chars: 8, align: "right" },
  "last-lap-delta": { chars: 6, align: "right" },
  "best-lap-delta": { chars: 6, align: "right" },
  lap: { chars: 3, align: "center" },
  "pit-lane": { chars: 3, align: "center" },
  "pit-stall": { chars: 5, align: "center" },
  "last-pitted": { chars: 4, align: "center" },
  "stint-lap": { chars: 3, align: "center" },
  "prev-stint": { chars: 3, align: "center" },
  "pos-change": { chars: 4, align: "center" },
  energy: { chars: 4, align: "right" },
};

/** One TableColumn per DriverFieldId, in DRIVER_FIELD_IDS order. Callers pass them all to DataTable; FieldConfig picks and orders. */
export function driverColumns(ctx: DriverColumnContext): TableColumn<DriverRow>[] {
  const renderers: Record<DriverFieldId, (row: DriverRow) => ReactNode> = {
    position: (r) => count(r.position),
    "overall-position": (r) => count(r.overallPosition),
    "car-number": carNumberCell,
    "car-class": (r) =>
      r.className === null ? NONE : <ClassBadge name={r.className} colour={r.classColour} />,
    driver: (r) => {
      const name = formatNameDisplay(r.driverName, r.teamName, ctx.nameDisplay, ctx.nameFormat);
      return name === "" ? NONE : name;
    },
    licence: (r) => <LicencePill licence={r.licence} />,
    irating: (r) => (
      <IRatingPill iRating={r.iRating} licence={r.licence} tinted={ctx.combinedLicencePill} />
    ),
    gap: (r) =>
      ctx.gapMode === "relative"
        ? formatDelta(r.relativeGapS, ctx.gapDecimals)
        : formatGap(r.gapToClassLeader, ctx.gapDecimals),
    interval: (r) => formatGap(r.interval, ctx.gapDecimals),
    "last-lap": (r) => lapCell(r.lastLapS, ctx.lapDecimals),
    "best-lap": (r) => lapCell(r.bestLapS, ctx.lapDecimals, r.fastest),
    "avg-lap": (r) => lapCell(r.avgLapS, ctx.lapDecimals),
    "last-lap-delta": (r) => (
      <span style={deltaStyle(r.lastLapDeltaS)}>
        {formatDelta(r.lastLapDeltaS, ctx.gapDecimals)}
      </span>
    ),
    "best-lap-delta": (r) => (
      <span style={deltaStyle(r.bestLapDeltaS)}>
        {formatDelta(r.bestLapDeltaS, ctx.gapDecimals)}
      </span>
    ),
    lap: (r) => count(r.lap),
    "pit-lane": (r) => (r.onPitRoad ? "PIT" : ""),
    "pit-stall": (r) => (r.inPitStall ? "STALL" : ""),
    "last-pitted": (r) => (r.lastPitLap === null ? NONE : `L${r.lastPitLap}`),
    "stint-lap": (r) => count(r.stintLaps),
    "prev-stint": (r) => count(r.prevStintLaps),
    "pos-change": (r) => <PositionDelta delta={r.positionsGained} />,
    energy: (r) => formatPercent(r.energyFraction),
  };
  return DRIVER_FIELD_IDS.map((id) => {
    const field = DRIVER_FIELDS.find((f) => f.id === id);
    const layout = LAYOUT[id];
    return {
      id,
      label: field?.label ?? id,
      align: layout.align,
      grow: layout.grow,
      chars: layout.chars,
      minChars: layout.minChars,
      defaultWidthPct: field?.defaultWidthPct ?? 8,
      render: renderers[id],
    };
  });
}

/** Row style for DataTable.rowStyle: { "--ov-class-colour": row.classColour } when known. */
export function driverRowStyle(row: DriverRow): CSSProperties | undefined {
  return row.classColour === null
    ? undefined
    : ({ "--ov-class-colour": row.classColour } as CSSProperties);
}
