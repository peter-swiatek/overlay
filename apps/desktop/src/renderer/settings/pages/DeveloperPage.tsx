import { useEffect, useState } from "react";
import {
  IDLE_CAPTURE_STATUS,
  MAX_LMU_FRAME_HZ,
  MIN_LMU_FRAME_HZ,
  type CaptureSettings,
  type CaptureStatus,
} from "../../../shared/capture-types";
import type { ProcessMetric } from "../../../shared/types";

const METRICS_INTERVAL_MS = 2000;

export function DeveloperPage() {
  const [metrics, setMetrics] = useState<ProcessMetric[]>([]);
  const [capture, setCapture] = useState<CaptureStatus>(IDLE_CAPTURE_STATUS);
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings>();

  useEffect(() => {
    void window.overlayApi.getCaptureStatus().then((s) => s && setCapture(s));
    void window.overlayApi.getCaptureSettings().then((s) => s && setCaptureSettings(s));
    return window.overlayApi.onCaptureStatus(setCapture);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      void window.overlayApi.getMetrics().then((m) => {
        if (!cancelled) setMetrics(m);
      });
    };
    poll();
    const timer = setInterval(poll, METRICS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const totalCpu = metrics.reduce((sum, m) => sum + m.cpuPercent, 0);
  const totalMem = metrics.reduce((sum, m) => sum + m.memoryMb, 0);

  return (
    <>
      <section>
        <h2>Fixture recording</h2>
        <p className="muted">
          Start and stop from the tray menu. Files go to the fixtures folder (tray: Open fixtures
          folder).
        </p>
        <table>
          <tbody>
            <tr>
              <td>Status</td>
              <td>
                {capture.recording
                  ? capture.file
                    ? `Recording ${capture.sim ?? ""}`
                    : "Waiting for iRacing or LMU"
                  : "Not recording"}
              </td>
            </tr>
            <tr>
              <td>Current file</td>
              <td>{capture.file ?? "none"}</td>
            </tr>
            <tr>
              <td>Size</td>
              <td>{(capture.sizeBytes / (1024 * 1024)).toFixed(1)} MB</td>
            </tr>
            <tr>
              <td>iRacing</td>
              <td>
                {capture.live.iracing ? "running" : "not detected"},{" "}
                {capture.fps.iracing.toFixed(1)} frames/s
              </td>
            </tr>
            <tr>
              <td>LMU</td>
              <td>
                {capture.live.lmu ? "running" : "not detected"}, {capture.fps.lmu.toFixed(1)}{" "}
                frames/s
              </td>
            </tr>
          </tbody>
        </table>
        {capture.error && <p className="note">{capture.error}</p>}
        <label className="option">
          <span>LMU frames per second</span>
          <input
            type="number"
            min={MIN_LMU_FRAME_HZ}
            max={MAX_LMU_FRAME_HZ}
            value={captureSettings?.lmuFrameHz ?? 5}
            disabled={!captureSettings}
            onChange={(e) => {
              const lmuFrameHz = Number(e.target.value);
              if (Number.isFinite(lmuFrameHz)) {
                void window.overlayApi.setCaptureSettings({ lmuFrameHz }).then(setCaptureSettings);
              }
            }}
          />
        </label>
      </section>

      <section>
        <h2>Resource usage</h2>
        <table>
          <thead>
            <tr>
              <th>Process type</th>
              <th>Count</th>
              <th>CPU %</th>
              <th>Memory MB</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.type}>
                <td>{m.type}</td>
                <td>{m.count}</td>
                <td>{m.cpuPercent.toFixed(1)}</td>
                <td>{m.memoryMb.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td />
              <td>{totalCpu.toFixed(1)}</td>
              <td>{totalMem.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">Refreshes every 2 s.</p>
      </section>
    </>
  );
}
