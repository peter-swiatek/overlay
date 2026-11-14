import type { SimName } from "@overlay/sim-core/types";
import { DataTable, type TableColumn } from "@overlay/ui";
import { formatLapTime } from "@overlay/ui/format";
import { useMemo, useRef } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean } from "../settings";
import { driverColumns, driverRowStyle, fieldsForSim, readTableOptions } from "../shared";
import { fitColumnsFor } from "../shared/table-fit";
import { ChProbe, useFittedFields } from "../shared/useFittedFields";
import "./battle-box.css";
import { battleBoxManifest } from "./manifest";
import { battleView, type BattleRow, type BattleView } from "./view";

interface Selected {
  view: BattleView;
  sim: SimName | null;
}

/** "-0.14s" / "+0.06s" / "0.00s"; "--" without both times. */
export function sectorDeltaText(delta: number | null): string {
  if (delta === null) return "--";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${sign}${Math.abs(delta).toFixed(2)}s`;
}

function tone(delta: number | null): string {
  if (delta === null || delta === 0) return "ov-bb-sector";
  return delta < 0 ? "ov-bb-sector ov-bb-sector--gain" : "ov-bb-sector ov-bb-sector--loss";
}

/** One tile per official sector: you against the other car in that sector. */
function SectorStrip({ deltas }: { deltas: readonly (number | null)[] }) {
  return (
    <div className="ov-bb-strip" style={{ gridTemplateColumns: `repeat(${deltas.length}, 1fr)` }}>
      {deltas.map((d, i) => (
        <div key={i} className={tone(d)}>
          <span className="ov-bb-sector-label">S{i + 1}</span>
          <b className="ov-bb-sector-value">{sectorDeltaText(d)}</b>
        </div>
      ))}
    </div>
  );
}

export function BattleBoxOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const table = readTableOptions(settings);
  const showStrips = optionBoolean(settings, "sector-strips");
  const rowLabels = optionBoolean(settings, "row-labels");
  const iRatingChange = optionBoolean(settings, "irating-change");
  const previous = useRef<readonly BattleRow[]>([]);
  const { prefs, livePositions, combinedLicencePill } = runtime;
  const { gapDecimals, lapDecimals } = table;

  const { view, sim } = runtime.useTelemetry<Selected>((frame) => {
    const next = battleView(frame, { livePositions, gapDecimals, lapDecimals }, previous.current);
    previous.current = next.rows;
    return { view: next, sim: frame?.state.sim ?? null };
  }, 10);

  const fields = useMemo(
    () => fieldsForSim(settings.common.fields, sim),
    [settings.common.fields, sim],
  );
  const fitColumns = useMemo(() => fitColumnsFor(battleBoxManifest, settings), [settings]);
  const fit = useFittedFields(fields, fitColumns, table.widthMode, table.widthScalePct);
  const shown = (id: string): boolean => fit.fields.some((f) => f.id === id && f.visible);
  const inlineFlagBadge = !shown("flag");
  const inlinePitBadge = !shown("pit-lane");

  const columns = useMemo((): TableColumn<BattleRow>[] => {
    const base = driverColumns({
      prefs,
      nameDisplay: table.nameDisplay,
      nameFormat: table.nameFormat,
      gapDecimals,
      lapDecimals,
      combinedLicencePill,
      gapMode: "standings",
      showIRatingChange: iRatingChange,
      iRatingSize: iRatingChange ? "wide" : "narrow",
      inlineFlagBadge,
      inlinePitBadge,
      pitInLastLap: false,
    });
    return base.map((column): TableColumn<BattleRow> => {
      if (column.id === "interval") {
        return {
          ...column,
          render: (row) => row.intText,
        };
      }
      if (column.id === "last-lap") {
        return {
          ...column,
          render: (row) =>
            row.lastFastest ? (
              <span className="ov-bb-fastest">{formatLapTime(row.lastLapS, lapDecimals)}</span>
            ) : (
              formatLapTime(row.lastLapS, lapDecimals)
            ),
        };
      }
      return column;
    });
  }, [
    prefs,
    table.nameDisplay,
    table.nameFormat,
    gapDecimals,
    lapDecimals,
    combinedLicencePill,
    iRatingChange,
    inlineFlagBadge,
    inlinePitBadge,
  ]);

  const { aheadSectors, behindSectors } = view;
  const rowAfter = (row: BattleRow) => {
    if (!showStrips) return null;
    if (row.role === "ahead" && aheadSectors !== null && aheadSectors.length > 0) {
      return <SectorStrip deltas={aheadSectors} />;
    }
    if (row.role === "own" && behindSectors !== null && behindSectors.length > 0) {
      return <SectorStrip deltas={behindSectors} />;
    }
    return null;
  };

  return (
    <div className="ov-bb" ref={fit.ref} data-hidden-columns={fit.hiddenIds.join(" ")}>
      <ChProbe />
      {view.rows.length === 0 ? (
        <div className="ov-bb-empty">Waiting for standings</div>
      ) : (
        <DataTable<BattleRow>
          columns={columns}
          config={fit.fields}
          rows={view.rows}
          rowKey={(r) => r.carIdx}
          widthMode={table.widthMode}
          widthScalePct={table.widthScalePct}
          showHeader={rowLabels}
          isOwnRow={(r) => r.isFocus}
          isYellowRow={(r) => r.yellow}
          rowStyle={driverRowStyle}
          rowAfter={rowAfter}
        />
      )}
    </div>
  );
}
