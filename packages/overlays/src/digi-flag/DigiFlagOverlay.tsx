import { useRef } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber } from "../settings";
import "./digi-flag.css";
import {
  digiFlagView,
  newGreenMemory,
  sampleDigiFlagView,
  type DigiFlagOptions,
  type GreenMemory,
} from "./view";

/** A digital marshalling panel: the player's current flag on a 5 x 5 LED grid. */
export function DigiFlagOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const memory = useRef<GreenMemory>(newGreenMemory());
  const options: DigiFlagOptions = {
    blink: optionBoolean(settings, "blink"),
    greenHoldS: optionNumber(settings, "green-seconds"),
  };
  const hideIdle = optionBoolean(settings, "hide-idle");
  // performance.now() inside the selector is fine: it runs at most rateHz times a second.
  const live = useTelemetry(
    (frame) => digiFlagView(frame, memory.current, performance.now() / 1000, options),
    10,
  );
  const idle = live === null || live.flag === null;
  const view = editing && idle ? sampleDigiFlagView(options) : live;
  if (view === null || (!editing && hideIdle && idle)) return <></>;

  const tone = view.tone === null ? " df--idle" : ` df--${view.tone}`;
  return (
    <div className={`df${tone}${view.blink ? " df--blink" : ""}`}>
      <div className="df-grid">
        {view.leds.map((on, i) => (
          <span key={i} className={on ? "df-led df-led--on" : "df-led"} />
        ))}
      </div>
      <div className="df-caption">{view.caption === "" ? " " : view.caption}</div>
    </div>
  );
}
