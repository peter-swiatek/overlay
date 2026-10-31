import { useOverlayRuntime } from "../runtime";
import { formatGear, formatSpeed, inputsView } from "./view";

const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** Brake, throttle and clutch bars, with gear, speed and a steering indicator. */
export function DemoInputsOverlay() {
  const { useTelemetry, prefs } = useOverlayRuntime();
  const v = useTelemetry(inputsView, 60);

  return (
    <div className="panel inputs">
      <div className="bar-track">
        <div className="bar brake" style={{ height: pct(v.brake) }} />
      </div>
      <div className="bar-track">
        <div className="bar throttle" style={{ height: pct(v.throttle) }} />
      </div>
      <div className="bar-track clutch-track">
        <div className="bar clutch" style={{ height: pct(v.clutch) }} />
      </div>
      <div className="readout">
        <div className="gear">{formatGear(v.gear)}</div>
        <div className="speed">{formatSpeed(v.speedMps, prefs)}</div>
        <div className="steer-track">
          <div className="steer-mark" style={{ left: pct((v.steer + 1) / 2) }} />
        </div>
      </div>
    </div>
  );
}
