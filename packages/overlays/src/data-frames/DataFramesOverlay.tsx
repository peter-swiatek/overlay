import type { CSSProperties } from "react";
import { useRef } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionString } from "../settings";
import "./data-frames.css";
import {
  newBiasMemory,
  sampleTiles,
  tileView,
  trackBiasBase,
  type BiasMemory,
  type TileView,
} from "./view";

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

/** One single-metric panel that fills the window. More tiles are more instances. */
export function DataFramesOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing, prefs, livePositions } = useOverlayRuntime();
  const memory = useRef<BiasMemory>(newBiasMemory());
  const metric = optionString(settings, "metric");
  const live = useTelemetry((frame) => {
    if (frame === null) return null;
    const biasBase = trackBiasBase(frame, memory.current);
    return tileView(metric, frame, { prefs, livePositions, biasBase });
  }, 10);
  const tile =
    live ??
    (editing
      ? (sampleTiles([metric])[0] ?? null)
      : tileView(metric, null, { prefs, livePositions, biasBase: null }));
  return <div className="dfr">{tile !== null && <Tile tile={tile} />}</div>;
}
