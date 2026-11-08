import { useRef, type CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { optionNumber, optionString } from "../settings";
import { useOverlayRuntime } from "../runtime";
import "./spotter.css";
import {
  barBottomCss,
  barColourCss,
  EDIT_SAMPLE,
  newSpotterMemory,
  spotterBlock,
  spotterView,
  type SpotterMemory,
  type SpotterSide,
} from "./view";

interface BarProps {
  side: SpotterSide;
  editing: boolean;
  length: number;
  width: number;
}

/** A capsule housing, drawn only while a car is on this side (or while editing). */
function Bar({ side, editing, length, width }: BarProps) {
  const block = spotterBlock(side);
  if (block === null && !editing) {
    // Keep the slot so the other bar does not move.
    return <div className="spotter-slot" style={{ width, height: length }} />;
  }
  return (
    <div className="spotter-bar" style={{ width, height: length }}>
      <div className="spotter-track">
        {block !== null && (
          <div
            className={`spotter-block spotter-block--from-${block.anchor}${side.double ? " spotter-block--double" : ""}`}
            style={
              {
                height: `${Math.round(block.height * 100)}%`,
                "--spotter-fill": Math.max(0.01, block.height),
              } as CSSProperties
            }
          />
        )}
        <div className="spotter-midpoint" />
      </div>
    </div>
  );
}

/** Two bars either side of centre; a block marks where a car alongside overlaps ours. */
export function SpotterOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const memory = useRef<SpotterMemory>(newSpotterMemory());
  // performance.now() inside the selector is fine: it runs at most rateHz times a second.
  const live = useTelemetry((frame) => spotterView(frame, memory.current, performance.now()), 30);

  const gap = optionNumber(settings, "bar-gap");
  const length = optionNumber(settings, "bar-length");
  const width = optionNumber(settings, "bar-width");
  const colour = barColourCss(optionString(settings, "bar-colour"));

  const nothing = live.left.position === null && live.right.position === null;
  const view = editing && nothing ? EDIT_SAMPLE : live;

  return (
    <div
      className={`spotter${editing ? " spotter--editing" : ""}`}
      style={
        {
          "--spotter-top": colour,
          "--spotter-bottom": barBottomCss(colour),
        } as CSSProperties
      }
    >
      <Bar side={view.left} editing={editing} length={length} width={width} />
      {/* bar-gap is centre to centre */}
      <div className="spotter-gap" style={{ width: Math.max(0, gap - width) }} />
      <Bar side={view.right} editing={editing} length={length} width={width} />
      {editing && (
        <div className="spotter-guide">
          Left bar: car ahead (top) · Right bar: car behind (bottom)
        </div>
      )}
    </div>
  );
}
