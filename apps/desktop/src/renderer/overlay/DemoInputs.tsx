import { useTelemetry } from "../telemetry/useTelemetry";
import { formatGear, inputsView, statusNotice } from "../telemetry/views";

const UPDATE_HZ = 60;

const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** Brake, throttle and clutch bars, with gear, speed and a steering indicator, at 60 Hz. */
export function DemoInputs() {
  const notice = useTelemetry(statusNotice, 10);
  const v = useTelemetry(inputsView, UPDATE_HZ);

  if (notice !== null) return <div className="panel notice">{notice}</div>;

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
        <div className="speed">{Math.round(v.speedKph)} km/h</div>
        <div className="steer-track">
          <div className="steer-mark" style={{ left: pct((v.steer + 1) / 2) }} />
        </div>
      </div>
    </div>
  );
}
