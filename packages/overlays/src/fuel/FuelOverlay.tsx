import { useRef, type ReactNode } from "react";
import { formatPercent, formatSessionTime, formatVolume } from "@overlay/ui/format";
import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean, optionNumber, optionString, visibleFields } from "../settings";
import "./fuel.css";
import {
  emptyFreezeMemory,
  freezeAtLine,
  fuelSnapshot,
  SAMPLE_FUEL_VIEW,
  usageFraction,
  type FuelView,
  type Tone,
} from "./view";

const NO_VALUE = "--";

function makeFormat(view: FuelView, prefs: DisplayPrefs) {
  /** An amount of fuel (litres or gallons) or of energy (percent). */
  const amount = (value: number | null, decimals: 1 | 2 = 1): string => {
    if (value === null) return NO_VALUE;
    if (view.unit === "energy") return formatPercent(value / 100, 1);
    const m = formatVolume(value, prefs, decimals);
    return `${m.value} ${m.unit}`;
  };
  const perLap = (value: number | null): string => {
    if (value === null) return NO_VALUE;
    return view.unit === "energy" ? `${amount(value)}/lap` : `${amount(value, 2)}/lap`;
  };
  const laps = (value: number | null): string => (value === null ? NO_VALUE : value.toFixed(1));
  return { amount, perLap, laps };
}

type Fmt = ReturnType<typeof makeFormat>;

function Bar({ fraction, label }: { fraction: number; label?: string }) {
  return (
    <div className="fuel-bar" role="img" aria-label={label}>
      <div className="fuel-bar-fill" style={{ width: `${(fraction * 100).toFixed(0)}%` }} />
    </div>
  );
}

function toneClass(tone: Tone): string {
  return tone === null ? "" : ` fuel-${tone}`;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="fuel-section" data-field={id}>
      <h3 className="fuel-title">{title}</h3>
      {children}
    </section>
  );
}

function pitWindowText(view: FuelView): string {
  const w = view.pitWindow;
  if (w === null) return NO_VALUE;
  if (!w.feasible) return "Pit window: not reachable on one stop";
  return `Laps ${w.start}–${w.end}`;
}

function renderField(id: string, view: FuelView, fmt: Fmt, title: string): ReactNode {
  switch (id) {
    case "consumption":
      return (
        <Section id={id} title={title}>
          <table className="fuel-table">
            <thead>
              <tr>
                <th />
                <th>Use/lap</th>
                <th>Laps</th>
                <th>Stint</th>
                <th>Refuel</th>
              </tr>
            </thead>
            <tbody>
              {view.consumption.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{fmt.amount(r.perLap, 2)}</td>
                  <td>{fmt.laps(r.laps)}</td>
                  <td>{fmt.laps(r.stintLaps)}</td>
                  <td>{fmt.amount(r.refuel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      );
    case "fuel-history":
      return (
        <Section id={id} title={title}>
          {view.history.length === 0 ? (
            <div className="fuel-muted">{NO_VALUE}</div>
          ) : (
            <div className="fuel-history">
              {view.history.map((lap) => (
                <div key={lap.lapNumber} className="fuel-history-lap">
                  <div className="fuel-history-track">
                    <div
                      className="fuel-history-fill"
                      style={{ height: `${(lap.fraction * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="fuel-small">{fmt.amount(lap.used, 2)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      );
    case "fuel-level":
      return (
        <Section id={id} title={title}>
          <div className="fuel-level-row">
            <span className="fuel-big">{fmt.amount(view.current)}</span>
            <span className="fuel-muted">
              {view.levelFraction === null ? NO_VALUE : formatPercent(view.levelFraction, 0)}
            </span>
          </div>
          <Bar fraction={view.levelFraction ?? 0} label="Fuel level" />
          <div className="fuel-small fuel-muted">
            {`${fmt.laps(view.lapsToGo)} laps in race · stint ${view.stintLaps} laps, ${formatSessionTime(view.stintTimeS)}`}
          </div>
        </Section>
      );
    case "targets":
      return (
        <Section id={id} title={title}>
          {view.targets.length === 0 ? (
            <div className="fuel-muted">{NO_VALUE}</div>
          ) : (
            view.targets.map((t) => (
              <div key={t.extraLaps} className="fuel-line">
                <span>{`${t.laps} laps`}</span>
                <span>{fmt.perLap(t.perLap)}</span>
              </div>
            ))
          )}
        </Section>
      );
    case "laps-left":
      return (
        <Section id={id} title={title}>
          <div className="fuel-triple">
            {(["avg", "last", "worst"] as const).map((k) => (
              <div key={k} className={`fuel-cell${toneClass(view.lapsLeftState[k])}`}>
                <span className="fuel-big">{fmt.laps(view.lapsLeft[k])}</span>
                <span className="fuel-small fuel-muted">{k}</span>
              </div>
            ))}
          </div>
        </Section>
      );
    case "laps-remaining":
      return (
        <Section id={id} title={title}>
          <span className="fuel-big">{fmt.laps(view.lapsToGo)}</span>
        </Section>
      );
    case "pit-window":
      return (
        <Section id={id} title={title}>
          <span className="fuel-big">{pitWindowText(view)}</span>
        </Section>
      );
    case "refuel":
      return (
        <Section id={id} title={title}>
          <span className="fuel-big">{fmt.amount(view.refuel)}</span>
        </Section>
      );
    case "usage":
      return (
        <Section id={id} title={title}>
          <div className="fuel-triple">
            {(
              [
                ["avg 10", view.usage.avg10],
                ["avg 5", view.usage.avg5],
                ["last", view.usage.last],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="fuel-cell">
                <span className="fuel-big">{fmt.amount(value, 2)}</span>
                <Bar fraction={usageFraction(value, view.maxBasis)} label={label} />
                <span className="fuel-small fuel-muted">{label}</span>
              </div>
            ))}
          </div>
        </Section>
      );
    default:
      return null;
  }
}

/** Titles of the manifest fields; kept here so the component does not import the manifest twice. */
const TITLES: Record<string, string> = {
  consumption: "Consumption",
  "fuel-history": "Fuel history",
  "fuel-level": "Fuel level",
  targets: "Fuel to finish",
  "laps-left": "Laps left",
  "laps-remaining": "Laps remaining",
  "pit-window": "Pit window",
  refuel: "Refuel",
  usage: "Usage",
};

export function FuelOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing } = useOverlayRuntime();
  const memory = useRef(emptyFreezeMemory());
  const options = {
    safetyMarginLaps: optionNumber(settings, "safety-margin"),
    liveUpdates: optionBoolean(settings, "live-updates"),
  };
  const snapshot = useTelemetry((frame) => fuelSnapshot(frame, options), 5);

  const live = options.liveUpdates
    ? snapshot.view
    : freezeAtLine(snapshot.view, snapshot.lapsCompleted, memory.current);
  const view = live ?? (editing ? SAMPLE_FUEL_VIEW : null);

  if (view === null) {
    return (
      <div className="panel fuel">
        <div className="fuel-muted">Waiting for a lap</div>
      </div>
    );
  }

  const fmt = makeFormat(view, prefs);
  const layout = optionString(settings, "layout") === "horizontal" ? "horizontal" : "vertical";
  return (
    <div className={`panel fuel fuel--${layout}`}>
      {visibleFields(settings).map((f) => (
        <div key={f.id} className="fuel-slot">
          {renderField(f.id, view, fmt, TITLES[f.id] ?? f.id)}
        </div>
      ))}
    </div>
  );
}
