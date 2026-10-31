import { useEffect, useState } from "react";
import {
  IDLE_CAPTURE_STATUS,
  MAX_LMU_FRAME_HZ,
  MIN_LMU_FRAME_HZ,
  type CaptureSettings,
  type CaptureStatus,
} from "../../../shared/capture-types";
import type { TelemetrySourceChoice, TelemetrySourceView } from "../../../shared/telemetry-types";
import type { PerfCheckResult, PerfProgress } from "../../../shared/perf-types";
import type { ProcessMetric } from "../../../shared/types";
import { Button, Row, Section, Segmented } from "../controls";

const METRICS_INTERVAL_MS = 2000;

const SOURCE_OPTIONS: { value: TelemetrySourceChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "iracing", label: "iRacing" },
  { value: "lmu", label: "LMU" },
  { value: "mock", label: "Mock" },
  { value: "replay", label: "Replay file" },
];

export function DataSourceSection({
  view,
  onSelect,
  onPickReplay,
}: {
  view: TelemetrySourceView | undefined;
  onSelect(source: Exclude<TelemetrySourceChoice, "replay">): void;
  onPickReplay(): void;
}) {
  const source = view?.source ?? "auto";
  return (
    <Section
      title="Data source"
      description="Where telemetry comes from. Test sources are for development."
    >
      <Row label="Source">
        <Segmented
          value={source}
          options={SOURCE_OPTIONS}
          onChange={(next) => {
            if (next === source) return;
            if (next === "replay") onPickReplay();
            else onSelect(next);
          }}
        />
      </Row>
      <Row label="Replay file" help={view?.replayPath ?? "none chosen"}>
        <Button variant="secondary" onClick={onPickReplay}>
          Choose replay file...
        </Button>
      </Row>
    </Section>
  );
}

export function CpuCheckSection() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PerfProgress>();
  const [result, setResult] = useState<PerfCheckResult>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    return window.overlayApi.onPerfProgress((p) => {
      setRunning(true);
      setProgress(p);
    });
  }, []);

  const start = (): void => {
    setRunning(true);
    setResult(undefined);
    setMessage(undefined);
    void window.overlayApi
      .startPerfCheck()
      .then((outcome) => {
        if (outcome.status === "done") setResult(outcome.result);
        else if (outcome.status === "cancelled") setMessage("Cancelled. Overlays are restored.");
        else setMessage(outcome.error);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setRunning(false);
        setProgress(undefined);
      });
  };

  const doneS = progress?.overallDoneS ?? 0;
  const totalS = progress?.overallTotalS ?? 0;
  const stepText =
    progress === undefined
      ? "Starting..."
      : progress.phase === "restore"
        ? "Restoring overlays..."
        : progress.phase === "settle"
          ? `Phase ${progress.phaseId}: ${progress.label}, settling`
          : `Phase ${progress.phaseId}: ${progress.label}, ${progress.elapsedS} of ${progress.totalS} s`;

  return (
    <Section
      title="CPU budget"
      description="Measures what the M2 overlays cost: 60 s with every overlay window closed, then 60 s with Leaderboard, Relative, Spotter, Pit speed and Fuel open, on the current data source. Your overlay settings are restored afterwards."
    >
      <Row label="Measure" help={running ? stepText : "Takes about two minutes."}>
        {running ? (
          <Button variant="danger" onClick={() => void window.overlayApi.cancelPerfCheck()}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={start}>
            Measure CPU
          </Button>
        )}
      </Row>
      {running && (
        <progress value={doneS} max={Math.max(1, totalS)} aria-label="CPU check progress" />
      )}
      {message && <p className="note">{message}</p>}
      {result && <CpuCheckResult result={result} />}
    </Section>
  );
}

function CpuCheckResult({ result }: { result: PerfCheckResult }) {
  const { phaseA, phaseB } = result;
  return (
    <>
      <p className="note">
        {result.pass ? "Within budget" : "Over budget"}: the overlays add{" "}
        <strong>{result.budgetPct.toFixed(2)} %</strong> of the machine (target {result.targetPct} %
        or less). {result.cores} cores, source {result.source}.
      </p>
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Mean %</th>
            <th>p95 %</th>
            <th>Samples</th>
          </tr>
        </thead>
        <tbody>
          {[phaseA, phaseB].map((p) => (
            <tr key={p.id}>
              <td>{p.label}</td>
              <td>{p.meanPct.toFixed(2)}</td>
              <td>{p.p95Pct.toFixed(2)}</td>
              <td>{p.samples}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Difference</td>
            <td>{result.budgetPct.toFixed(2)}</td>
            <td>{result.p95DiffPct.toFixed(2)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Process type</th>
            <th>Closed %</th>
            <th>Open %</th>
            <th>Added %</th>
          </tr>
        </thead>
        <tbody>
          {result.byType.map((t) => (
            <tr key={t.type}>
              <td>{t.type}</td>
              <td>{t.aMeanPct.toFixed(2)}</td>
              <td>{t.bMeanPct.toFixed(2)}</td>
              <td>{t.deltaPct.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.suggestions.map((text) => (
        <p className="note" key={text}>
          {text}
        </p>
      ))}
      {result.file && <p className="muted">Saved to {result.file}</p>}
    </>
  );
}

export function DeveloperPage() {
  const [sourceView, setSourceView] = useState<TelemetrySourceView>();
  const [metrics, setMetrics] = useState<ProcessMetric[]>([]);
  const [capture, setCapture] = useState<CaptureStatus>(IDLE_CAPTURE_STATUS);
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings>();

  useEffect(() => {
    void window.overlayApi.telemetry.getSource().then(setSourceView);
    return window.overlayApi.telemetry.onSourceChanged(setSourceView);
  }, []);

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
      <DataSourceSection
        view={sourceView}
        onSelect={(source) =>
          void window.overlayApi.telemetry.setSource(source).then(setSourceView)
        }
        onPickReplay={() => void window.overlayApi.telemetry.pickReplayFile().then(setSourceView)}
      />

      <Section
        title="Fixture recording"
        description="Start and stop from the tray menu. Files go to the fixtures folder (tray: Open fixtures folder)."
      >
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
        <Row label="LMU frames per second">
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
        </Row>
      </Section>

      <CpuCheckSection />

      <Section title="Resource usage">
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
      </Section>
    </>
  );
}
