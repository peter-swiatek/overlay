import type { SimName } from "@overlay/sim-core/types";
import { DataTable } from "@overlay/ui";
import type { CSSProperties } from "react";
import { useMemo, useRef } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionStrings } from "../settings";
import {
  InfoStrip,
  driverColumns,
  driverRowStyle,
  fieldsForSim,
  infoItems,
  readTableOptions,
  type DriverRow,
  type InfoItem,
} from "../shared";
import "./relative.css";
import { relativeView, type RelativeRow, type RelativeView } from "./view";

interface Selected {
  view: RelativeView;
  header: InfoItem[];
  footer: InfoItem[];
  sim: SimName | null;
}

export function RelativeOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const table = readTableOptions(settings);
  const showHeader = optionBoolean(settings, "weather-header");
  const showFooter = optionBoolean(settings, "session-footer");
  const flagBorder = optionBoolean(settings, "flag-border");
  const rowLabels = optionBoolean(settings, "row-labels");
  const showDqLimit = optionBoolean(settings, "show-dq-limit");
  const headerIds = showHeader ? optionStrings(settings, "header-fields") : [];
  const footerIds = showFooter ? optionStrings(settings, "footer-fields") : [];
  const ahead = optionNumber(settings, "drivers-ahead");
  const behind = optionNumber(settings, "drivers-behind");
  const hideInPits = optionBoolean(settings, "hide-in-pits");
  const gapThreat = optionBoolean(settings, "gap-threat");
  const previous = useRef<readonly RelativeRow[]>([]);

  const { prefs, livePositions, combinedLicencePill } = runtime;
  const { gapDecimals, lapDecimals, sessionDisplay } = table;

  const selected = runtime.useTelemetry<Selected>((frame) => {
    const view = relativeView(
      frame,
      {
        ahead,
        behind,
        hideInPits,
        gapThreat,
        livePositions,
        gapDecimals,
        lapDecimals,
        headerIds,
        footerIds,
      },
      previous.current,
    );
    previous.current = view.rows;
    const ctx = { prefs, sessionDisplay, showDqLimit, now: new Date() };
    return {
      view,
      sim: frame?.state.sim ?? null,
      header: infoItems(frame, headerIds, ctx),
      footer: infoItems(frame, footerIds, ctx),
    };
  }, 10);
  const { view, sim } = selected;
  const fields = useMemo(
    () => fieldsForSim(settings.common.fields, sim),
    [settings.common.fields, sim],
  );

  const columns = useMemo(() => {
    const base = driverColumns({
      prefs,
      nameDisplay: table.nameDisplay,
      nameFormat: table.nameFormat,
      gapDecimals,
      lapDecimals,
      combinedLicencePill,
      gapMode: "relative",
    });
    return base.map((column) =>
      column.id === "gap"
        ? {
            ...column,
            render: (row: DriverRow) => (
              <span className={threatClass((row as RelativeRow).threat)}>{column.render(row)}</span>
            ),
          }
        : column,
    );
  }, [prefs, table.nameDisplay, table.nameFormat, gapDecimals, lapDecimals, combinedLicencePill]);

  const style: CSSProperties | undefined =
    flagBorder && view.flagColour !== null
      ? { boxShadow: `inset 0 0 0 3px ${view.flagColour}` }
      : undefined;

  return (
    <div className="ov-rel" style={style}>
      {showHeader ? <InfoStrip items={selected.header} /> : null}
      {view.rows.length === 0 ? (
        <div className="ov-rel-empty">No cars nearby</div>
      ) : (
        <DataTable
          columns={columns}
          config={fields}
          rows={view.rows}
          rowKey={(r) => r.carIdx}
          widthMode={table.widthMode}
          widthScalePct={table.widthScalePct}
          showHeader={rowLabels}
          isOwnRow={(r) => r.isFocus}
          rowStyle={driverRowStyle}
        />
      )}
      {showFooter ? <InfoStrip items={selected.footer} /> : null}
    </div>
  );
}

function threatClass(level: "red" | "yellow" | null | undefined): string | undefined {
  return level === "red" || level === "yellow" ? `ov-rel-threat--${level}` : undefined;
}
