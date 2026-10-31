import { useMemo, useRef } from "react";
import { ClassBadge, DataTable, type TableSection } from "@overlay/ui";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionStrings } from "../settings";
import {
  driverColumns,
  driverRowStyle,
  infoItems,
  InfoStrip,
  readTableOptions,
  type DriverRow,
} from "../shared";
import "./leaderboard.css";
import { leaderboardView, reuseView, type LeaderboardView } from "./view";

const AFTER_GAP = "ov-lb-after-gap";

function carCount(total: number): string {
  return total === 1 ? "1 car" : `${total} cars`;
}

export function LeaderboardOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, livePositions, combinedLicencePill } = useOverlayRuntime();
  const table = readTableOptions(settings);
  const showAll = optionBoolean(settings, "show-all");
  const around = optionNumber(settings, "around");
  const topMyClass = optionNumber(settings, "top-my-class");
  const topOtherClasses = optionNumber(settings, "top-other-classes");
  const sessionHeader = optionBoolean(settings, "session-header");
  const rowLabels = optionBoolean(settings, "row-labels");
  const showDqLimit = optionBoolean(settings, "show-dq-limit");
  const headerIds = optionStrings(settings, "header-fields");

  const previous = useRef<LeaderboardView | null>(null);
  const { view, header } = useTelemetry((frame) => {
    const next = reuseView(
      previous.current,
      leaderboardView(frame, {
        showAll,
        around,
        topMyClass,
        topOtherClasses,
        livePositions,
        gapDecimals: table.gapDecimals,
        lapDecimals: table.lapDecimals,
      }),
    );
    previous.current = next;
    return {
      view: next,
      header: sessionHeader
        ? infoItems(frame, headerIds, {
            prefs,
            sessionDisplay: table.sessionDisplay,
            showDqLimit,
            now: new Date(),
          })
        : [],
    };
  }, 5);

  const columns = useMemo(
    () =>
      driverColumns({
        prefs,
        nameDisplay: table.nameDisplay,
        nameFormat: table.nameFormat,
        gapDecimals: table.gapDecimals,
        lapDecimals: table.lapDecimals,
        combinedLicencePill,
        gapMode: "standings",
      }),
    [
      prefs,
      combinedLicencePill,
      table.nameDisplay,
      table.nameFormat,
      table.gapDecimals,
      table.lapDecimals,
    ],
  );
  const gapRows = useMemo(() => new Set(view.afterGap), [view.afterGap]);
  const rowCount = view.sections.reduce((n, s) => n + s.rows.length, 0);

  const common = {
    columns,
    config: settings.common.fields,
    rowKey: (r: DriverRow) => r.carIdx,
    widthMode: table.widthMode,
    widthScalePct: table.widthScalePct,
    showHeader: rowLabels,
    isOwnRow: (r: DriverRow) => r.isFocus,
    rowClassName: (r: DriverRow) => (gapRows.has(r.carIdx) ? AFTER_GAP : undefined),
    rowStyle: driverRowStyle,
  };
  const sections: TableSection<DriverRow>[] = view.sections.map((s) => ({
    key: s.key,
    label: (
      <>
        <ClassBadge name={s.label} colour={s.colour} />
        <span className="ov-lb-count">{carCount(s.total)}</span>
      </>
    ),
    colour: s.colour,
    rows: s.rows,
  }));

  return (
    <div className="panel leaderboard">
      <InfoStrip items={header} />
      {rowCount === 0 ? (
        <div className="ov-lb-empty">Waiting for standings</div>
      ) : view.multiClass ? (
        <DataTable<DriverRow> {...common} sections={sections} />
      ) : (
        <DataTable<DriverRow> {...common} rows={view.sections[0]?.rows ?? []} />
      )}
    </div>
  );
}
