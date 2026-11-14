import { useRef } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber } from "../settings";
import "./rejoin-helper.css";
import {
  newRejoinMemory,
  rejoinView,
  sampleRejoinView,
  type RejoinMemory,
  type RejoinOptions,
} from "./view";

/** One row: the gap to the next car behind, a divider, and whether it is safe to rejoin. */
export function RejoinHelperOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const memory = useRef<RejoinMemory>(newRejoinMemory());
  const options: RejoinOptions = {
    redS: optionNumber(settings, "red-seconds"),
    cautionS: optionNumber(settings, "caution-seconds"),
    alwaysShow: optionBoolean(settings, "always-show"),
  };
  // performance.now() inside the selector is fine: it runs at most rateHz times a second.
  const live = useTelemetry(
    (frame) => rejoinView(frame, memory.current, performance.now() / 1000, options),
    10,
  );
  const view = live ?? (editing ? sampleRejoinView() : null);
  if (view === null) return <></>;
  return (
    <div className={`rj rj--${view.tone}`}>
      <span className="rj-gap">
        {view.gap}
        {view.gap === "--" ? null : <small>s</small>}
      </span>
      <i className="rj-div" />
      <span className="rj-txt">
        <span className="rj-label">NEXT CAR</span>
        <b className="rj-condition">{view.condition}</b>
      </span>
    </div>
  );
}
