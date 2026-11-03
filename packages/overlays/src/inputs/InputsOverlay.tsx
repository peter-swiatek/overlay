import { useRef } from "react";
import { formatSpeed } from "@overlay/ui/format";
import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { formatGear } from "../shared/driving";
import { optionBoolean, optionNumber, visibleFields } from "../settings";
import { InputTrace, absPath, tracePoints, type InputSample, type TraceKey } from "./trace";
import { barValue, inputsView, type InputsView } from "./view";
import "./inputs.css";

/** Trace well size in board px. */
const WELL_W = 344;
const WELL_H = 96;
/** The steering pill: a 40 degree arc on a circle of radius 40 in the 89 px hub. */
const HUB = 89;
const PILL_R = 40;
const PILL_HALF_DEG = 20;

const GRID = [0.25, 0.5, 0.75];

function gridY(fraction: number): number {
  return 4 + (1 - fraction) * (WELL_H - 8);
}

function pillPath(): string {
  const c = HUB / 2;
  const a = (PILL_HALF_DEG * Math.PI) / 180;
  const dx = PILL_R * Math.sin(a);
  const dy = PILL_R * Math.cos(a);
  return `M ${(c - dx).toFixed(2)} ${(c - dy).toFixed(2)} A ${PILL_R} ${PILL_R} 0 0 1 ${(c + dx).toFixed(2)} ${(c - dy).toFixed(2)}`;
}
const PILL_PATH = pillPath();

export interface InputsPanelProps {
  view: InputsView;
  samples: readonly InputSample[];
  windowS: number;
  prefs: DisplayPrefs;
  showHub: boolean;
  showTrace: boolean;
  showBars: boolean;
  showClutch: boolean;
  showSteering: boolean;
}

/** The panel for one view and a set of recent samples (separate from the hook for testing). */
export function InputsPanel(p: InputsPanelProps) {
  const { view: v, samples, windowS } = p;
  const nowS = samples.length > 0 ? (samples[samples.length - 1] as InputSample).t : 0;
  const line = (key: TraceKey) => tracePoints(samples, key, nowS, windowS, WELL_W, WELL_H);
  const abs = absPath(samples, nowS, windowS, WELL_W, WELL_H);
  const speed = formatSpeed(v.speedMps, p.prefs);

  const bars: { id: string; label: string; value: number; cls: string }[] = [
    { id: "throttle", label: "Throttle", value: v.throttle, cls: "inp-fill-throttle" },
    { id: "brake", label: "Brake", value: v.brake, cls: "inp-fill-brake" },
  ];
  if (p.showClutch) {
    bars.push({ id: "clutch", label: "Clutch", value: v.clutch, cls: "inp-fill-clutch" });
  }

  return (
    <div
      className="inp-panel"
      role="img"
      aria-label={`Inputs: gear ${formatGear(v.gear)}, ${speed.value} ${speed.unit}`}
    >
      {p.showHub && (
        <div className="inp-hub">
          <svg className="inp-pill" viewBox={`0 0 ${HUB} ${HUB}`} aria-hidden="true">
            <path
              className="inp-pill-arc"
              d={PILL_PATH}
              transform={`rotate(${v.wheelDeg.toFixed(1)} ${HUB / 2} ${HUB / 2})`}
            />
          </svg>
          <div className="inp-disc">
            <span className="inp-gear">{formatGear(v.gear)}</span>
            <span className="inp-speed">{speed.value}</span>
          </div>
        </div>
      )}
      {p.showTrace && (
        <div className="inp-well">
          <svg
            viewBox={`0 0 ${WELL_W} ${WELL_H}`}
            width={WELL_W}
            height={WELL_H}
            aria-hidden="true"
          >
            {GRID.map((g) => (
              <line key={g} className="inp-grid" x1={0} x2={WELL_W} y1={gridY(g)} y2={gridY(g)} />
            ))}
            {p.showSteering && (
              <polyline className="inp-line inp-line-steer" points={line("steer")} />
            )}
            {p.showClutch && (
              <polyline className="inp-line inp-line-clutch" points={line("clutch")} />
            )}
            <polyline className="inp-line inp-line-throttle" points={line("throttle")} />
            <polyline className="inp-line inp-line-brake" points={line("brake")} />
            {abs !== "" && <path className="inp-line inp-line-abs" d={abs} />}
          </svg>
        </div>
      )}
      {p.showBars && (
        <div className="inp-bars">
          {bars.map((b) => (
            <div key={b.id} className="inp-bar" data-bar={b.id}>
              <span className="inp-bar-value">{barValue(b.value)}</span>
              <div className="inp-bar-well">
                <div
                  className={`inp-bar-fill ${b.cls}`}
                  style={{ height: `${barValue(b.value)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Gear and speed hub, a few seconds of pedal and steering trace, and the pedal bars. */
export function InputsOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs } = useOverlayRuntime();
  const v = useTelemetry(inputsView, 60);
  const windowS = optionNumber(settings, "trace-seconds");
  const trace = useRef<InputTrace | null>(null);
  const lastT = useRef<number | null>(null);
  trace.current ??= new InputTrace(windowS);
  trace.current.setWindow(windowS);

  if (v.active && v.tickTimeS !== null && v.tickTimeS !== lastT.current) {
    lastT.current = v.tickTimeS;
    trace.current.push({
      t: v.tickTimeS,
      throttle: v.throttle,
      brake: v.brake,
      clutch: v.clutch,
      steer: v.steer,
      abs: v.abs,
    });
  }

  const fields = visibleFields(settings);
  const has = (id: string) => fields.some((f) => f.id === id);
  return (
    <InputsPanel
      view={v}
      samples={trace.current.samples}
      windowS={windowS}
      prefs={prefs}
      showHub={has("hub")}
      showTrace={has("trace")}
      showBars={has("bars")}
      showClutch={optionBoolean(settings, "show-clutch")}
      showSteering={optionBoolean(settings, "show-steering-trace")}
    />
  );
}
