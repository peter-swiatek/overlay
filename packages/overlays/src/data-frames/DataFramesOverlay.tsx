import type { CSSProperties } from "react";
import { useRef } from "react";
import type { OverlayInstanceSettings } from "../contract";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionNumber, optionString } from "../settings";
import "./data-frames.css";
import { MAX_TILES, tileKey } from "./metrics";
import {
  dataFramesView,
  newBiasMemory,
  sampleTiles,
  trackBiasBase,
  type BiasMemory,
  type TileView,
} from "./view";

/** Tile count, columns (never more than the tiles) and rows. */
export function tileGrid(settings: OverlayInstanceSettings): {
  metrics: string[];
  columns: number;
  rows: number;
  gapPx: number;
} {
  const count = Math.min(MAX_TILES, Math.max(1, Math.round(optionNumber(settings, "tiles"))));
  const metrics = Array.from({ length: count }, (_, i) => optionString(settings, tileKey(i + 1)));
  const columns = Math.min(count, Math.max(1, Math.round(optionNumber(settings, "columns"))));
  return {
    metrics,
    columns,
    rows: Math.ceil(count / columns),
    gapPx: optionNumber(settings, "gap"),
  };
}

function valueClass(tile: TileView): string {
  if (tile.chip) return "dfr-value dfr-pos-chip";
  return tile.valueTone === null ? "dfr-value" : `dfr-value dfr-value--${tile.valueTone}`;
}

function Tile({ tile }: { tile: TileView }) {
  const style =
    tile.chip && tile.classColour !== null
      ? ({ "--class-color": tile.classColour } as CSSProperties)
      : undefined;
  return (
    <div className="dfr-tile" data-metric={tile.metric}>
      <div className="dfr-label">{tile.label}</div>
      <div className={tile.chip ? "dfr-row dfr-row--chip" : "dfr-row"}>
        <span className={valueClass(tile)} style={style}>
          {tile.value}
        </span>
        {tile.secondary !== null && (
          <span className={tile.secondaryTone === "loss" ? "dfr-sub dfr-sub--loss" : "dfr-sub"}>
            {tile.secondary}
          </span>
        )}
      </div>
    </div>
  );
}

/** Separate single-metric panels in a grid that fills the window, transparent between them. */
export function DataFramesOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing, prefs, livePositions } = useOverlayRuntime();
  const memory = useRef<BiasMemory>(newBiasMemory());
  const grid = tileGrid(settings);
  const key = grid.metrics.join(",");
  const live = useTelemetry((frame) => {
    if (frame === null) return null;
    const biasBase = trackBiasBase(frame, memory.current);
    return dataFramesView(key.split(","), frame, { prefs, livePositions, biasBase });
  }, 10);
  const tiles =
    live ??
    (editing
      ? sampleTiles(grid.metrics)
      : dataFramesView(grid.metrics, null, { prefs, livePositions, biasBase: null }));
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
    gap: `${grid.gapPx}px`,
  };
  return (
    <div className="dfr" style={style}>
      {tiles.map((tile, i) => (
        <Tile key={i} tile={tile} />
      ))}
    </div>
  );
}
