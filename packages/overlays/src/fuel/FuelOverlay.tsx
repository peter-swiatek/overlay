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
  const laps = (value: number | null): string => (value === null ? NO_VALUE : value.toFixed(1));
  return { amount, laps };
}

type Fmt = ReturnType<typeof makeFormat>;
type Layout = "vertical" | "horizontal";

interface BlockProps {
  view: FuelView;
  fmt: Fmt;
  layout: Layout;
  /** Ids of the visible fields, so blocks can fold into each other (refuel, laps remaining). */
  shown: ReadonlySet<string>;
}

function Bar({ fraction, label }: { fraction: number; label?: string }) {
  return (
    <div className="fuel-bar" role="img" aria-label={label}>
      <div className="fuel-bar-fill" style={{ width: `${(fraction * 100).toFixed(0)}%` }} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="fuel-section" data-field={id}>
      <h3 className="fuel-sec-label">{title}</h3>
      {children}
    </section>
  );
}

function pitWindowText(view: FuelView): string {
  const w = view.pitWindow;
  if (w === null) return NO_VALUE;
  if (view.refuel !== null && view.refuel <= 0) return "No stop needed";
  if (!w.feasible) return "Pit window: not reachable on one stop";
  return `Lap ${w.start}–${w.end}`;
}

const percentText = (view: FuelView): string =>
  view.levelFraction === null ? NO_VALUE : formatPercent(view.levelFraction, 0);

/** "<amount> (<pct>)" of the tank. */
const levelText = (view: FuelView, fmt: Fmt): string =>
  `${fmt.amount(view.current, 2)} (${percentText(view)})`;

function Gauge({ view }: { view: FuelView }) {
  return (
    <div className="fuel-gauge-well" role="img" aria-label="Fuel level">
      <div
        className="fuel-gauge-fill"
        style={{ width: `${((view.levelFraction ?? 0) * 100).toFixed(0)}%` }}
      />
    </div>
  );
}

function LapsInRace({ view, fmt }: { view: FuelView; fmt: Fmt }) {
  return (
    <span className="fuel-meta-pair" data-field="laps-remaining">
      <span>
        <span className="fuel-muted">Laps in race</span> <b>{fmt.laps(view.lapsToGo)}</b>
      </span>
      <span>
        <span className="fuel-muted">Stint</span> <b>{formatSessionTime(view.stintTimeS)}</b>
      </span>
    </span>
  );
}

function FuelHead({ view, children }: { view: FuelView; children?: ReactNode }) {
  return (
    <div className="fuel-head">
      <span>Fuel Calculator</span>
      {children ?? <span>{view.currentLap === null ? NO_VALUE : `Lap ${view.currentLap}`}</span>}
    </div>
  );
}

function TankCard({ view, fmt, layout, shown }: BlockProps) {
  if (layout === "horizontal") {
    return (
      <div className="fuel-tank-card fuel-tank-card--row" data-field="fuel-level">
        <Gauge view={view} />
        <div className="fuel-tank-figures">
          <b>{levelText(view, fmt)}</b>
          <b>{view.currentLap === null ? NO_VALUE : `Lap ${view.currentLap}`}</b>
        </div>
      </div>
    );
  }
  return (
    <div className="fuel-tank-card" data-field="fuel-level">
      <Gauge view={view} />
      <div className="fuel-gauge-meta">
        <span className="fuel-muted">E</span>
        <b>{levelText(view, fmt)}</b>
        <span className="fuel-muted">{fmt.amount(view.capacity, 2)}</span>
      </div>
      {shown.has("laps-remaining") ? (
        <div className="fuel-gauge-meta fuel-gauge-meta--small">
          <LapsInRace view={view} fmt={fmt} />
        </div>
      ) : null}
    </div>
  );
}

function Consumption({ view, fmt, shown }: BlockProps) {
  const refuel = shown.has("refuel");
  return (
    <div className={`fuel-cons${refuel ? "" : " fuel-cons--no-refuel"}`} data-field="consumption">
      <div className="fuel-cons-header">
        <span />
        <span>AVG</span>
        <span>LAPS</span>
        <span>STINT</span>
        {refuel ? <span>REFUEL</span> : null}
      </div>
      <div className="fuel-cons-body">
        {view.consumption.map((r) => (
          <div key={r.label} className="fuel-cons-row">
            <span>{r.label}</span>
            <span>{fmt.amount(r.perLap, 2)}</span>
            <span>{fmt.laps(r.laps)}</span>
            <span>{fmt.laps(r.stintLaps)}</span>
            {refuel ? (
              <span>
                <span className="fuel-refuel-pill">{fmt.amount(r.refuel)}</span>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function RefuelBanner({ view, fmt }: { view: FuelView; fmt: Fmt }) {
  return (
    <div className="fuel-banner fuel-banner--loss" data-field="refuel">
      <span>Refuel</span>
      <b>{fmt.amount(view.refuel)}</b>
    </div>
  );
}

function Targets({ view, fmt }: { view: FuelView; fmt: Fmt }) {
  return (
    <div className="fuel-targets" data-field="targets">
      {view.targets.length === 0 ? (
        <div className="fuel-target-cell fuel-muted">{NO_VALUE}</div>
      ) : (
        view.targets.map((t) => (
          <div key={t.extraLaps} className="fuel-target-cell">
            <div className="fuel-target-lbl">{`${t.laps} laps`}</div>
            <div className="fuel-target-val">{fmt.amount(t.perLap, 2)}</div>
          </div>
        ))
      )}
    </div>
  );
}

const LAPS_LEFT: readonly (readonly ["last" | "avg" | "worst", string])[] = [
  ["last", "LAST"],
  ["avg", "AVG"],
  ["worst", "WORST"],
];

const toneName = (tone: Tone): string => (tone === null ? "none" : tone);

function LapsLeft({ view, fmt }: { view: FuelView; fmt: Fmt }) {
  return (
    <div className="fuel-rem" data-field="laps-left">
      <div className="fuel-rem-header">
        <span>LAPS REMAINING</span>
        <span>
          TIME: <b>{formatSessionTime(view.timeRemainingS)}</b>
        </span>
      </div>
      <div className="fuel-rem-grid">
        {LAPS_LEFT.map(([key, label]) => (
          <div
            key={key}
            className={`fuel-rem-cell fuel-rem-cell--${toneName(view.lapsLeftState[key])}`}
          >
            <span className="fuel-rem-lbl">{label}</span>
            <span className="fuel-rem-val">{fmt.laps(view.lapsLeft[key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PitBanner({ view, layout }: { view: FuelView; layout: Layout }) {
  return (
    <div className="fuel-banner fuel-banner--gain" data-field="pit-window">
      <span>{layout === "horizontal" ? "PIT" : "PIT WINDOW"}</span>
      <b>{pitWindowText(view)}</b>
    </div>
  );
}

function Usage({ view, fmt }: { view: FuelView; fmt: Fmt }) {
  return (
    <Section id="usage" title="Usage">
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
}

function History({ view, fmt }: { view: FuelView; fmt: Fmt }) {
  // Bars scale against the largest lap shown, so older laps (6-10) are not squashed by a
  // maximum from a lap that is no longer on screen.
  const shownMax = Math.max(0, ...view.history.map((lap) => lap.used));
  return (
    <Section id="fuel-history" title="Fuel history">
      {view.history.length === 0 ? (
        <div className="fuel-muted">{NO_VALUE}</div>
      ) : (
        <div className="fuel-history">
          {view.history.map((lap) => (
            <div key={lap.lapNumber} className="fuel-history-lap">
              <div className="fuel-history-track">
                <div
                  className="fuel-history-fill"
                  style={{
                    height: `${(shownMax > 0 ? Math.min(1, lap.used / shownMax) * 100 : 0).toFixed(0)}%`,
                  }}
                />
              </div>
              <span className="fuel-small">{fmt.amount(lap.used, 2)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Vertical layout: one block per visible field, in the user's order. */
function verticalBlock(id: string, p: BlockProps): ReactNode {
  switch (id) {
    case "fuel-level":
      return (
        <>
          <FuelHead view={p.view} />
          <TankCard {...p} />
        </>
      );
    case "laps-remaining":
      // Folded into the tank card while Fuel level is shown.
      return p.shown.has("fuel-level") ? null : (
        <div className="fuel-tank-card">
          <div className="fuel-gauge-meta fuel-gauge-meta--small">
            <LapsInRace view={p.view} fmt={p.fmt} />
          </div>
        </div>
      );
    case "consumption":
      return <Consumption {...p} />;
    case "refuel":
      // A column of the consumption table while that is shown, else a banner.
      return p.shown.has("consumption") ? null : <RefuelBanner view={p.view} fmt={p.fmt} />;
    case "targets":
      return <Targets view={p.view} fmt={p.fmt} />;
    case "laps-left":
      return <LapsLeft view={p.view} fmt={p.fmt} />;
    case "pit-window":
      return <PitBanner view={p.view} layout="vertical" />;
    case "usage":
      return <Usage view={p.view} fmt={p.fmt} />;
    case "fuel-history":
      return <History view={p.view} fmt={p.fmt} />;
    default:
      return null;
  }
}

/**
 * Horizontal layout: a fixed grid whatever the field order. Rows: head, tank card, two columns
 * (consumption | laps left and pit window), targets; usage and history are extra rows.
 */
function Horizontal(p: BlockProps): ReactNode {
  const { shown, view, fmt } = p;
  const has = (id: string): boolean => shown.has(id);
  const left = has("consumption") || has("refuel");
  const right = has("laps-left") || has("pit-window");
  return (
    <>
      {has("fuel-level") || has("laps-remaining") ? (
        <FuelHead view={view}>
          {has("laps-remaining") ? <LapsInRace view={view} fmt={fmt} /> : <span />}
        </FuelHead>
      ) : null}
      {has("fuel-level") ? <TankCard {...p} /> : null}
      {left || right ? (
        <div className={`fuel-split${left && right ? "" : " fuel-split--single"}`}>
          {left ? (
            <div className="fuel-split-col">
              {has("consumption") ? <Consumption {...p} /> : <RefuelBanner view={view} fmt={fmt} />}
            </div>
          ) : null}
          {right ? (
            <div className="fuel-split-col">
              {has("laps-left") ? <LapsLeft view={view} fmt={fmt} /> : null}
              {has("pit-window") ? <PitBanner view={view} layout="horizontal" /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {has("targets") ? <Targets view={view} fmt={fmt} /> : null}
      {has("usage") ? <Usage view={view} fmt={fmt} /> : null}
      {has("fuel-history") ? <History view={view} fmt={fmt} /> : null}
    </>
  );
}

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

  const layout: Layout =
    optionString(settings, "layout") === "horizontal" ? "horizontal" : "vertical";
  const fields = visibleFields(settings);
  const props: BlockProps = {
    view,
    fmt: makeFormat(view, prefs),
    layout,
    shown: new Set(fields.map((f) => f.id)),
  };
  return (
    <div className={`panel fuel fuel--${layout}`}>
      {layout === "horizontal" ? (
        <Horizontal {...props} />
      ) : (
        fields.map((f) => {
          const block = verticalBlock(f.id, props);
          return block === null ? null : (
            <div key={f.id} className="fuel-slot">
              {block}
            </div>
          );
        })
      )}
    </div>
  );
}
