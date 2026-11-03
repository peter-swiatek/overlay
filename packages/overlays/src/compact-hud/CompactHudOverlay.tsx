import type { CSSProperties } from "react";
import { formatDistance, formatSpeed } from "@overlay/ui/format";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString } from "../settings";
import { formatGear, LIGHT_COLOUR_VAR, lightColour } from "../shared/driving";
import { hudShape } from "./shape";
import {
  compactHudView,
  EDIT_SAMPLE,
  HUD_LIGHT_STEPS,
  type CompactHudView,
  type HudOptions,
  type LapLine,
  type ProximityLevel,
} from "./view";
import "./compact-hud.css";

const PROXIMITY_COLOUR: Record<ProximityLevel, string> = {
  close: "var(--ov-locked-loss)",
  near: "var(--ov-locked-flag-yellow)",
  far: "var(--ov-text-muted)",
};
const LAP_COLOUR: Record<LapLine, string> = {
  lapping: "var(--ov-locked-flag-blue)",
  lapped: "var(--ov-locked-loss)",
};

function readOptions(settings: OverlayProps["settings"]): HudOptions {
  return {
    gapRangeS: optionNumber(settings, "gap-range"),
    showGapTabs: optionBoolean(settings, "show-gap-tabs"),
    showProximity: optionBoolean(settings, "show-proximity"),
    showPitCountdown: optionBoolean(settings, "show-pit-countdown"),
    showSlowCar: optionBoolean(settings, "show-slow-car"),
    slowCarRangeM: optionNumber(settings, "slow-car-range"),
    shiftSource: optionString(settings, "shift-lights") === "custom" ? "custom" : "car",
  };
}

/** The 12 shift-light segments: pair i lights from the outside in, mirrored. */
function Lights({ view, blink }: { view: CompactHudView; blink: boolean }) {
  const { lit, shift } = view.lights;
  const segments: JSX.Element[] = [];
  for (let slot = 0; slot < HUD_LIGHT_STEPS * 2; slot++) {
    const step = slot < HUD_LIGHT_STEPS ? slot : HUD_LIGHT_STEPS * 2 - 1 - slot;
    const on = step < lit;
    const colour = shift
      ? LIGHT_COLOUR_VAR.shift
      : LIGHT_COLOUR_VAR[lightColour(step, HUD_LIGHT_STEPS)];
    segments.push(
      <i
        key={slot}
        className={on ? "hud-light hud-light--on" : "hud-light"}
        style={{ background: colour }}
      />,
    );
  }
  return <div className={blink ? "hud-lights hud-blink" : "hud-lights"}>{segments}</div>;
}

export function CompactHudOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing, reduceVisualEffects } = useOverlayRuntime();
  const options = readOptions(settings);
  const live = useTelemetry((frame) => compactHudView(frame, options), 30);
  if (!live.active && !editing) return <></>;
  const v: CompactHudView = live.active ? live : EDIT_SAMPLE;

  const speed = formatSpeed(v.speedMps, prefs);
  const blink = v.lights.blink && !reduceVisualEffects;
  const aheadShown = v.ahead !== null;
  const behindShown = v.behind !== null;
  const gear = formatGear(v.gear);

  const label = [
    `Speed ${speed.value} ${speed.unit}`,
    `gear ${gear}`,
    v.ahead ? `${v.ahead.gapS.toFixed(1)} seconds to the car ahead` : null,
    v.behind ? `${v.behind.gapS.toFixed(1)} seconds to the car behind` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(", ");

  const status = v.status;
  const statusDistance = status === null ? null : formatDistance(status.distanceM, prefs);

  return (
    <div className="hud" role="group" aria-label={label}>
      <svg className="hud-shape" viewBox="0 0 340 172" aria-hidden="true">
        <path
          className={v.limiter ? "body hud-body--lim" : "body"}
          d={hudShape(aheadShown, behindShown)}
        />
        {v.ahead?.lapLine && (
          <path
            className="lap"
            d="M128,28.5 L212,28.5"
            style={{ stroke: LAP_COLOUR[v.ahead.lapLine] }}
          />
        )}
        {v.behind?.lapLine && (
          <path
            className="lap"
            d="M128,167.5 L212,167.5"
            style={{ stroke: LAP_COLOUR[v.behind.lapLine] }}
          />
        )}
      </svg>

      {status !== null && statusDistance !== null && (
        <div
          className={
            status.kind === "slow" ? "hud-status hud-status--slow" : "hud-status hud-status--pit"
          }
        >
          {status.kind === "slow" ? (
            <span>
              ▲ Slow car ahead · {statusDistance.value} {statusDistance.unit}
            </span>
          ) : (
            <>
              <span>
                Pit box {statusDistance.value} {statusDistance.unit}
              </span>
              <span className="hud-pitbar">
                <i style={{ width: `${Math.round(status.fill * 100)}%` }} />
              </span>
            </>
          )}
        </div>
      )}

      {v.ahead && (
        <div className="hud-tab hud-tab--ahead" style={{ color: "var(--ov-locked-gain)" }}>
          +{v.ahead.gapS.toFixed(1)}
        </div>
      )}
      {v.behind && (
        <div className="hud-tab hud-tab--behind" style={{ color: "var(--ov-locked-loss)" }}>
          -{v.behind.gapS.toFixed(1)}
        </div>
      )}

      <div className="hud-cap">
        <svg className="hud-arcs" viewBox="0 0 330 100" aria-hidden="true">
          <path className="hud-track" d="M50,87 A37,37 0 0 1 50,13" pathLength="100" />
          <path
            className="hud-arc hud-arc--brake"
            d="M50,87 A37,37 0 0 1 50,13"
            pathLength="100"
            style={{ strokeDasharray: `${v.brake * 100} 100` } as CSSProperties}
          />
          <path className="hud-track" d="M280,87 A37,37 0 0 0 280,13" pathLength="100" />
          <path
            className="hud-arc hud-arc--throttle"
            d="M280,87 A37,37 0 0 0 280,13"
            pathLength="100"
            style={{ strokeDasharray: `${v.throttle * 100} 100` } as CSSProperties}
          />
        </svg>

        <Lights view={v} blink={blink} />

        <div className="hud-num hud-num--speed">
          <b>{speed.value}</b>
          <span>{speed.unit}</span>
        </div>
        <div
          className={`hud-gear${v.lights.shift ? " hud-gear--shift" : ""}${blink ? " hud-blink" : ""}`}
        >
          {gear}
        </div>
        <div className="hud-num hud-num--rpm">
          <b>{v.rpm === null ? "--" : v.rpm}</b>
          <span>RPM</span>
        </div>

        {v.abs && <div className="hud-badge hud-badge--abs">ABS</div>}
        {v.limiter && <div className="hud-badge hud-badge--lim">LIM</div>}

        <div className="hud-steer">
          <i style={{ left: `${v.pinPx}px` }} />
        </div>

        {v.proximityAhead && (
          <>
            <div
              className="hud-prox hud-prox--l hud-prox--ahead"
              style={{ background: PROXIMITY_COLOUR[v.proximityAhead] }}
            />
            <div
              className="hud-prox hud-prox--r hud-prox--ahead"
              style={{ background: PROXIMITY_COLOUR[v.proximityAhead] }}
            />
          </>
        )}
        {v.proximityBehind && (
          <>
            <div
              className="hud-prox hud-prox--l hud-prox--behind"
              style={{ background: PROXIMITY_COLOUR[v.proximityBehind] }}
            />
            <div
              className="hud-prox hud-prox--r hud-prox--behind"
              style={{ background: PROXIMITY_COLOUR[v.proximityBehind] }}
            />
          </>
        )}
      </div>
    </div>
  );
}
