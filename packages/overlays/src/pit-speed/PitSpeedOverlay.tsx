import { formatDistance, formatSpeed } from "@overlay/ui/format";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { visibleFields } from "../settings";
import { EDIT_SAMPLE, pitSpeedView, type PitSpeedView } from "./view";
import "./pit-speed.css";

// Defaults Peter has not confirmed (chosen by the orchestrator):
// - "Pit stop info" is the distance to the pit box on pit road, and "Stall" while stopped in it.
// - LMU reports no pit speed limit, so the limit sign shows "--" and the bar is left out.

export function PitSpeedOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing } = useOverlayRuntime();
  const live = useTelemetry(pitSpeedView, 20);
  if (!live.active && !editing) return <></>;
  const v: PitSpeedView = live.active ? live : EDIT_SAMPLE;
  const over = v.state === "over";
  const speed = formatSpeed(v.speedMps, prefs);
  const limit = formatSpeed(v.limitMps, prefs);

  const fields = visibleFields(settings);
  const showLimit = fields.some((f) => f.id === "limit");
  const bar = showLimit && v.fillFraction !== null;

  const render = (id: string) => {
    switch (id) {
      case "limit":
        return (
          <div key={id} className="ps-sign">
            <span className="ps-sign-text">{v.limitMps === null ? "--" : limit.value}</span>
          </div>
        );
      case "speed": {
        const tone = v.state === null ? "" : over ? " ps-over" : " ps-under";
        return (
          <div key={id} className={`ps-speed${tone}`}>
            <div className="ps-speed-row">
              <span className="ps-num">{speed.value}</span>
              <span className="ps-unit">{speed.unit}</span>
            </div>
            {bar && (
              <div className="ps-bar">
                <div
                  className={over ? "ps-fill ps-fill-over" : "ps-fill ps-fill-under"}
                  style={{ width: `${((v.fillFraction ?? 0) * 100).toFixed(0)}%` }}
                />
              </div>
            )}
          </div>
        );
      }
      case "limiter":
        return (
          <div key={id} className={v.limiterOn === true ? "ps-pill ps-pill-on" : "ps-pill"}>
            {v.limiterOn === null ? "--" : v.limiterOn ? "LIM ON" : "LIM OFF"}
          </div>
        );
      case "pit-stop-info": {
        if (v.inPitStall) {
          return (
            <div key={id} className="ps-info">
              Stall
            </div>
          );
        }
        if (v.distanceToBoxM === null) return null;
        const d = formatDistance(v.distanceToBoxM, prefs);
        return (
          <div key={id} className="ps-info">
            Box {d.value} {d.unit}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return <div className="panel ps-panel">{fields.map((f) => render(f.id))}</div>;
}
