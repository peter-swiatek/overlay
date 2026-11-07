import { referenceLabel } from "@overlay/sim-core/pure";
import type { BestTime } from "@overlay/sim-core/types";
import { CarNumberBadge } from "@overlay/ui";
import { useMemo, type CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { formatLapDelta, formatSpeedDelta, formatStripLapTime } from "./format";
import type { HeadToHeadCar } from "./head-to-head";
import {
  deltaBarView,
  editSample,
  readDeltaBarOptions,
  type DeltaBarView,
  type Tone,
} from "./view";
import "./delta-bar.css";

/** Width of the live delta and speed tiles, equal so the best-times tile gets the spare width. */
const SIDE_TILE_PX = 118;

const toneClass = (tone: Tone): string =>
  tone === "gain" ? " dl-gain" : tone === "loss" ? " dl-loss" : "";

function Triangle({ rotate, className }: { rotate: number; className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 10 10"
      aria-hidden="true"
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <path d="M5 1 L9.5 9 H0.5 Z" fill="currentColor" />
    </svg>
  );
}

function BestRow({ label, best, hidden }: { label: string; best: BestTime; hidden: boolean }) {
  const diff = hidden ? null : best.lastLapDeltaS;
  return (
    <div>
      <span className="k">{label}</span>
      <span className={best.setByLastLap ? "t dl-fastest" : "t"}>
        {formatStripLapTime(best.lapTimeS)}
      </span>
      <span
        className={`d${toneClass(diff === null ? null : diff < 0 ? "gain" : diff > 0 ? "loss" : null)}`}
      >
        {diff === null ? "" : formatLapDelta(diff)}
      </span>
    </div>
  );
}

function H2hTile({ car, direction }: { car: HeadToHeadCar | null; direction: "ahead" | "behind" }) {
  if (car === null) return <div className="dl-tile dl-h2h-tile dl-h2h-empty" />;
  const style =
    car.classColour === null ? undefined : ({ "--class-color": car.classColour } as CSSProperties);
  const diff = car.lastLapDiffS;
  const diffTone: Tone = diff === null || diff === 0 ? null : diff > 0 ? "gain" : "loss";
  return (
    <div className="dl-tile dl-h2h-tile" style={style} data-side={direction}>
      <Triangle className="dl-dir" rotate={direction === "ahead" ? 0 : 180} />
      <span className="pos">{`P${car.classPosition}`}</span>
      <CarNumberBadge carNumber={car.carNumber} />
      <span className="nm">{car.name}</span>
      <span className="gp">{car.gapText}</span>
      <span className={`d${toneClass(diffTone)}`}>{diff === null ? "" : formatLapDelta(diff)}</span>
    </div>
  );
}

export function DeltaBarOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing, livePositions, reduceVisualEffects } = useOverlayRuntime();
  const options = useMemo(() => readDeltaBarOptions(settings), [settings]);
  const live = useTelemetry((frame) => deltaBarView(frame, options, livePositions), 20);
  if (!live.visible && !editing) return <></>;
  const v: DeltaBarView = live.visible ? live : editSample(options);

  const speed = formatSpeedDelta(v.speedDeltaMps, prefs);
  const flat = speed.value === "0" || speed.value === "--";
  const speedCls = flat
    ? " dl-spd--flat"
    : v.speedDeltaMps !== null && v.speedDeltaMps > 0
      ? " dl-spd--gain"
      : " dl-spd--loss";

  // The live delta and speed tiles share one fixed width; the best-times tile takes the rest.
  // Without best times, the live delta stretches instead.
  const tile = `${SIDE_TILE_PX}px`;
  const cols = [
    options.showBestTimes ? "minmax(0, 1fr)" : null,
    options.showBestTimes ? tile : "minmax(0, 1fr)",
    options.showDeltaSpeed ? tile : null,
  ]
    .filter((c) => c !== null)
    .join(" ");

  const refTitle =
    v.referenceKind === null
      ? "Live delta"
      : `Live delta vs ${referenceLabel(v.referenceKind)} ${formatStripLapTime(v.referenceLapS)}`;
  const range = v.rangeS.toFixed(1);
  const fill = Number((v.bar.fraction * 50).toFixed(2));
  const barFillStyle: CSSProperties =
    v.bar.tone === "gain"
      ? { left: `${Number((50 - fill).toFixed(2))}%`, width: `${fill}%` }
      : { left: "50%", width: `${fill}%` };
  const lap = v.lapComplete;
  const h2h = v.headToHead;

  return (
    <div className="dl">
      <div className="dl-top" style={{ gridTemplateColumns: cols }}>
        {options.showBestTimes && (
          <div
            className="dl-tile dl-bt"
            aria-label="Best times, last lap compared with the previous bests"
          >
            <BestRow label="All-time Best" best={v.allTimeBest} hidden={v.bestDeltasHidden} />
            <BestRow label="Session Best" best={v.sessionBest} hidden={v.bestDeltasHidden} />
          </div>
        )}
        <div className="dl-tile dl-delta" title={refTitle}>
          <span className={`dl-num${toneClass(v.tone)}`}>{formatLapDelta(v.deltaS)}</span>
          {v.trend !== null && (
            <span className={v.trend === "falling" ? "dl-gain" : "dl-loss"}>
              <Triangle className="dl-trend" rotate={v.trend === "falling" ? 180 : 0} />
            </span>
          )}
        </div>
        {options.showDeltaSpeed && (
          <div
            className={`dl-tile dl-spd${speedCls}`}
            title="Speed vs the reference lap at this point"
          >
            <b>{speed.value}</b>
            <small>{speed.unit}</small>
          </div>
        )}
      </div>
      <div className="dl-tile dl-barrow">
        <div className="dl-barline">
          <span>{`-${range}`}</span>
          <div
            className="dl-bar"
            role="img"
            aria-label={`Delta ${formatLapDelta(v.deltaS)} seconds on a plus or minus ${v.rangeS} second scale`}
          >
            <i className="tick" style={{ left: "25%" }} />
            <i className="tick" style={{ left: "75%" }} />
            {v.bar.tone !== null && v.bar.fraction > 0 && (
              <i className={`fill fill-${v.bar.tone}`} style={barFillStyle} />
            )}
            <i className="mid" />
          </div>
          <span>{`+${range}`}</span>
        </div>
        <div className="dl-times">
          <span>
            Pred<b className={toneClass(v.tone).trim()}>{formatStripLapTime(v.predictedLapS)}</b>
          </span>
          <span>
            Last<b>{formatStripLapTime(v.lastLapS)}</b>
          </span>
          <span>
            Optimal<b className="dl-fastest">{formatStripLapTime(v.optimalLapS)}</b>
          </span>
        </div>
        {lap !== null && (
          <div className="dl-lap" aria-label="Lap complete">
            {lap.best && (
              <span className={reduceVisualEffects ? "best" : "best dl-blink"}>BEST</span>
            )}
            <span className="time">{formatStripLapTime(lap.lapTimeS)}</span>
            {lap.deltaS !== null && (
              <span className={`dt ${lap.deltaS < 0 ? "dl-fill-gain" : "dl-fill-loss"}`}>
                {formatLapDelta(lap.deltaS)}
              </span>
            )}
          </div>
        )}
      </div>
      {h2h !== null && (
        <div className="dl-h2h">
          <H2hTile car={h2h.ahead} direction="ahead" />
          <H2hTile car={h2h.behind} direction="behind" />
        </div>
      )}
    </div>
  );
}
