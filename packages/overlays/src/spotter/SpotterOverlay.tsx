import { useRef, type CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { optionNumber, optionString } from "../settings";
import { useOverlayRuntime } from "../runtime";
import "./spotter.css";
import {
  barColourCss,
  EDIT_SAMPLE,
  newSpotterMemory,
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

function Bar({ side, editing, length, width }: BarProps) {
  const blockLength = length / 2;
  const showTrack = editing || side.position !== null;
  return (
    <div
      className={`spotter-bar${showTrack ? " spotter-bar--track" : ""}`}
      style={{ width, height: length }}
    >
      {side.position !== null && (
        <div
          className={`spotter-block${side.double ? " spotter-block--double" : ""}`}
          style={{
            height: blockLength,
            transform: `translateY(${side.position * (length - blockLength)}px)`,
          }}
        />
      )}
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
      style={{ "--spotter-colour": colour } as CSSProperties}
    >
      <Bar side={view.left} editing={editing} length={length} width={width} />
      {/* bar-gap is centre to centre */}
      <div className="spotter-gap" style={{ width: Math.max(0, gap - width) }} />
      <Bar side={view.right} editing={editing} length={length} width={width} />
    </div>
  );
}
