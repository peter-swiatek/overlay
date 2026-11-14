import type { SimName } from "@overlay/sim-core/types";
import { DataTable, type TableColumn } from "@overlay/ui";
import { useMemo, useRef, type CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber } from "../settings";
import { driverColumns, driverRowStyle, fieldsForSim, readTableOptions } from "../shared";
import { fitColumnsFor } from "../shared/table-fit";
import { ChProbe, useFittedFields } from "../shared/useFittedFields";
import { overtakeAlertManifest } from "./manifest";
import "./overtake-alert.css";
import { overtakeView, rowTops, sampleOvertakeRows, type OvertakeRow } from "./view";

interface Selected {
  rows: OvertakeRow[];
  sim: SimName | null;
}

/** Row height the tops are worked out in: the table's own row height. */
const ROW_HEIGHT = "var(--ov-row-height, 24px)";

/**
 * Faster-class cars closing from behind, as the Relative's rows on a transparent window: each row
 * sits at the bottom at the far end of the window and rises to the top as its gap closes.
 */
export function OvertakeAlertOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const table = readTableOptions(settings);
  const windowS = optionNumber(settings, "window-seconds");
  const maxRows = optionNumber(settings, "max-rows");
  const includeSameClass = optionBoolean(settings, "same-class");
  const iRatingChange = optionBoolean(settings, "irating-change");
  const previous = useRef<readonly OvertakeRow[]>([]);
  const { prefs, livePositions, combinedLicencePill, editing } = runtime;
  const { gapDecimals, lapDecimals } = table;

  const selected = runtime.useTelemetry<Selected>((frame) => {
    const rows = overtakeView(
      frame,
      { windowS, maxRows, includeSameClass, livePositions, gapDecimals, lapDecimals },
      previous.current,
    );
    previous.current = rows;
    return { rows, sim: frame?.state.sim ?? null };
  }, 10);
  const sample = useMemo(() => sampleOvertakeRows(windowS), [windowS]);
  const rows = selected.rows.length > 0 || !editing ? selected.rows : sample;

  const fields = useMemo(
    () => fieldsForSim(settings.common.fields, selected.sim),
    [settings.common.fields, selected.sim],
  );
  const fitColumns = useMemo(() => fitColumnsFor(overtakeAlertManifest, settings), [settings]);
  const fit = useFittedFields(fields, fitColumns, table.widthMode, table.widthScalePct);

  const columns = useMemo((): TableColumn<OvertakeRow>[] => {
    const base = driverColumns({
      prefs,
      nameDisplay: table.nameDisplay,
      nameFormat: table.nameFormat,
      gapDecimals,
      lapDecimals,
      combinedLicencePill,
      gapMode: "relative",
      showIRatingChange: iRatingChange,
      iRatingSize: iRatingChange ? "wide" : "narrow",
      // No flag or pit-lane column here: a flag shows after the name, as in the Relative.
      inlineFlagBadge: true,
      inlinePitBadge: true,
      pitInLastLap: false,
    });
    return base.map((column): TableColumn<OvertakeRow> => {
      if (column.id !== "gap") return column;
      return {
        ...column,
        render: (row) => <span className="ov-oa-gap">{row.gapText}</span>,
      };
    });
  }, [
    prefs,
    table.nameDisplay,
    table.nameFormat,
    gapDecimals,
    lapDecimals,
    combinedLicencePill,
    iRatingChange,
  ]);

  const tops = useMemo(() => {
    const byCar = new Map<number, string>();
    const list = rowTops(
      rows.map((r) => r.progress),
      ROW_HEIGHT,
    );
    rows.forEach((r, i) => byCar.set(r.carIdx, list[i] ?? "0px"));
    return byCar;
  }, [rows]);
  const rowStyle = (row: OvertakeRow): CSSProperties =>
    ({ ...driverRowStyle(row), "--oa-top": tops.get(row.carIdx) }) as CSSProperties;

  return (
    <div className="ov-oa" ref={fit.ref} data-hidden-columns={fit.hiddenIds.join(" ")}>
      <ChProbe />
      {rows.length === 0 ? null : (
        <DataTable<OvertakeRow>
          columns={columns}
          config={fit.fields}
          rows={rows}
          rowKey={(r) => r.carIdx}
          widthMode={table.widthMode}
          widthScalePct={table.widthScalePct}
          showHeader={false}
          isYellowRow={(r) => r.yellow}
          rowStyle={rowStyle}
        />
      )}
    </div>
  );
}
