import { formatLapTime, formatPercent, formatSpeed, formatTemperature } from "@overlay/ui/format";
import type { CSSProperties } from "react";
import { formatGear, LIGHT_COLOUR_VAR, type ShiftLightSource } from "../shared/driving";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionString, visibleFields } from "../settings";
import { ringArc, type RingArc } from "./ring";
import { EDIT_SAMPLE, stripView, type StripView } from "./view";
import "./telemetry-strip.css";

const NO_VALUE = "--";

function Arc({ arc, className }: { arc: RingArc; className: string }) {
  if (!arc.show) return null;
  return (
    <circle
      className={className}
      cx={68}
      cy={68}
      r={63}
      strokeLinecap={arc.cap}
      strokeDasharray={arc.dasharray}
      style={{ transform: `rotate(${arc.rotateDeg.toFixed(2)}deg)` }}
    />
  );
}

function Ring({ view }: { view: StripView }) {
  return (
    <svg className="ts-ring" aria-hidden="true" width={136} height={136} viewBox="0 0 136 136">
      <circle className="ts-ring-track" cx={68} cy={68} r={63} />
      <Arc arc={ringArc(0, view.throttle * 360)} className="ts-throttle" />
      <Arc arc={ringArc(-view.brake * 360, view.brake * 360)} className="ts-brake" />
    </svg>
  );
}

export function TelemetryStripOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing, livePositions, reduceVisualEffects } = useOverlayRuntime();
  const source: ShiftLightSource =
    optionString(settings, "shift-lights") === "custom" ? "custom" : "car";
  const live = useTelemetry((frame) => stripView(frame, livePositions, source), 30);
  if (!live.active && !editing) return <></>;
  const v: StripView = live.active ? live : EDIT_SAMPLE;

  const shown = new Set(visibleFields(settings).map((f) => f.id));
  const speed = formatSpeed(v.speedMps, prefs);
  const track = formatTemperature(v.trackTempC, prefs, 0);
  const blinking = v.blink && !reduceVisualEffects;
  const gained = v.placesGained;

  return (
    <div
      className="ts-root"
      role="group"
      aria-label={`Telemetry strip, gear ${formatGear(v.gear)}, ${speed.value} ${speed.unit}`}
    >
      <div className="ts-panel ts-panel-cut">
        <div className="ts-row1">
          {shown.has("speed") && (
            <div className="ts-speed">
              <span className="ts-speed-num">{speed.value}</span>
              <span className="ts-label">{speed.unit.toUpperCase()}</span>
            </div>
          )}
          {shown.has("shift-lights") && (
            <div
              className={blinking ? "ts-leds ts-blink" : "ts-leds"}
              role="img"
              aria-label="Shift lights"
            >
              {v.leds.map((led, i) => (
                <span
                  key={i}
                  className={led === null ? "ts-led" : "ts-led ts-led-on"}
                  style={
                    led === null ? undefined : ({ "--led": LIGHT_COLOUR_VAR[led] } as CSSProperties)
                  }
                />
              ))}
            </div>
          )}
          {shown.has("rpm") && (
            <div className="ts-rpm">
              <span className="ts-label">RPM</span>
              <span className="ts-rpm-num">{v.rpm === null ? NO_VALUE : Math.round(v.rpm)}</span>
            </div>
          )}
        </div>
        <div className="ts-band ts-band-cut">
          {shown.has("position") && (
            <>
              <span className="ts-pos">{v.position === null ? NO_VALUE : `P${v.position}`}</span>
              {gained !== null && gained !== 0 && (
                <span className={gained > 0 ? "ts-chip ts-chip-gain" : "ts-chip ts-chip-loss"}>
                  {gained > 0 ? `+${gained}` : `-${-gained}`}
                </span>
              )}
            </>
          )}
          {shown.has("fuel") && (
            <div className="ts-stat">
              <span className="ts-label">FUEL</span>
              <span className="ts-stat-num">
                {v.fuelFraction === null ? NO_VALUE : formatPercent(v.fuelFraction)}
              </span>
            </div>
          )}
          {shown.has("last-lap") && (
            <div className="ts-stat">
              <span className="ts-label">LAST</span>
              <span className="ts-stat-num">
                {v.lastLapS === null ? NO_VALUE : formatLapTime(v.lastLapS, 3)}
              </span>
            </div>
          )}
          {shown.has("track-temp") && (
            <div className="ts-stat">
              <span className="ts-label">TRK</span>
              <span className="ts-stat-num">
                {v.trackTempC === null ? NO_VALUE : `${track.value} ${track.unit}`}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="ts-hub" aria-label="Gear">
        {shown.has("gear-ring") && <Ring view={v} />}
        <div className="ts-disc">
          <span className={blinking ? "ts-gear ts-blink" : "ts-gear"}>{formatGear(v.gear)}</span>
        </div>
      </div>
    </div>
  );
}
