import type { CSSProperties } from "react";
import { formatDistance, formatSpeed } from "@overlay/ui/format";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { visibleFields } from "../settings";
import { EDIT_SAMPLE, pitSpeedView, type PitSpeedView } from "./view";
import "./pit-speed.css";

// Defaults Peter has not confirmed (chosen by the orchestrator):
// - "Pit stop info" is the distance to the pit box on pit road, and "In pit stall" while stopped in it.
// - LMU reports no pit speed limit, so it shows "Limit not reported" in place of the bar.

/** Fill from the centre to the position: a half-width element scaled from its inner edge. */
function fillStyle(position: number): CSSProperties {
  const left = position < 0;
  return {
    left: left ? "0" : "50%",
    transformOrigin: left ? "right center" : "left center",
    transform: `scaleX(${Math.abs(position).toFixed(2)})`,
  };
}

export function PitSpeedOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing } = useOverlayRuntime();
  const live = useTelemetry(pitSpeedView, 20);
  if (!live.active && !editing) return <></>;
  const v: PitSpeedView = live.active ? live : EDIT_SAMPLE;
  const over = v.state === "over";
  const speed = formatSpeed(v.speedMps, prefs);
  const limit = formatSpeed(v.limitMps, prefs);

  const render = (id: string) => {
    switch (id) {
      case "speed":
        return (
          <div key={id} className={over ? "ps-speed ps-over" : "ps-speed"}>
            <span className="ps-num">{speed.value}</span>
            <span className="ps-unit">{speed.unit}</span>
          </div>
        );
      case "limit":
        if (v.limitMps === null) {
          return (
            <div key={id} className="ps-limit">
              Limit not reported
            </div>
          );
        }
        return (
          <div key={id} className="ps-limit">
            <div>
              Limit {limit.value} {limit.unit}
            </div>
            <div className="ps-bar">
              <div
                className={over ? "ps-fill ps-fill-over" : "ps-fill ps-fill-under"}
                style={fillStyle(v.barPosition ?? 0)}
              />
              <div className="ps-centre" />
            </div>
          </div>
        );
      case "limiter":
        return (
          <div key={id} className={v.limiterOn === true ? "ps-pill ps-pill-on" : "ps-pill"}>
            {v.limiterOn === null ? "--" : v.limiterOn ? "ON" : "OFF"}
          </div>
        );
      case "pit-stop-info": {
        if (v.inPitStall) {
          return (
            <div key={id} className="ps-info">
              In pit stall
            </div>
          );
        }
        if (v.distanceToBoxM === null) return null;
        const d = formatDistance(v.distanceToBoxM, prefs);
        return (
          <div key={id} className="ps-info">
            Box in {d.value} {d.unit}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return <div className="panel ps-panel">{visibleFields(settings).map((f) => render(f.id))}</div>;
}
