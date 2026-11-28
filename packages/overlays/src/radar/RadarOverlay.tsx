import { useRef, type CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { optionBoolean, optionNumber } from "../settings";
import { useOverlayRuntime } from "../runtime";
import "./radar.css";
import {
  arcPath,
  carRect,
  CENTRE,
  classColourCss,
  EDIT_SAMPLE,
  newRadarMemory,
  radarClear,
  radarView,
  RING_INNER,
  RING_MIDDLE,
  RING_OUTER,
  VIEW,
  type RadarCar,
  type RadarMemory,
  type RadarOptions,
} from "./view";

/** Gap between a car's tail and its label baseline, in view units (the design's 12 for a 44 car). */
const LABEL_GAP = 11;

function OtherCar({
  car,
  options,
  labels,
}: {
  car: RadarCar;
  options: RadarOptions;
  labels: boolean;
}) {
  const r = carRect(car.x, car.y, options);
  const colour = classColourCss(car.colour);
  const style = colour === null ? undefined : ({ "--radar-class": colour } as CSSProperties);
  const labelY = Math.min(VIEW - 4, r.y + r.h + LABEL_GAP);
  // Under the car, running away from our own car so the text never covers it: a car on the right
  // starts its label at its left edge, one on the left ends it at its right edge.
  const anchor = car.x > 0.05 ? "start" : car.x < -0.05 ? "end" : "middle";
  const labelX = anchor === "start" ? r.x : anchor === "end" ? r.x + r.w : r.x + r.w / 2;
  return (
    <g className={`radar-car${car.alongside ? " radar-car--alongside" : ""}`} style={style}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx} />
      {labels && car.label !== null && (
        <text
          className="radar-label"
          x={Math.round(labelX * 100) / 100}
          y={labelY}
          textAnchor={anchor}
        >
          {car.label}
        </text>
      )}
    </g>
  );
}

/** Cars around the player from above, ahead = up, to scale within the range rings. */
export function RadarOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const memory = useRef<RadarMemory>(newRadarMemory());
  const options: RadarOptions = {
    rangeM: optionNumber(settings, "range"),
    carLengthM: optionNumber(settings, "car-length"),
    carWidthM: optionNumber(settings, "car-width"),
  };
  const labels = optionBoolean(settings, "car-labels");
  const hideWhenClear = optionBoolean(settings, "hide-when-clear");
  // performance.now() inside the selector is fine: it runs at most rateHz times a second.
  const live = useTelemetry(
    (frame) => radarView(frame, memory.current, performance.now(), options),
    30,
  );

  const clear = radarClear(live);
  const view = editing && clear ? EDIT_SAMPLE : live;
  const hidden = !editing && (view === null || (hideWhenClear && clear));
  const player = carRect(0, 0, options);

  return (
    <div className={`radar${hidden ? " radar--hidden" : ""}`} aria-hidden={hidden || undefined}>
      <svg className="radar-svg" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Radar">
        <circle className="radar-ring radar-ring--outer" cx={CENTRE} cy={CENTRE} r={RING_OUTER} />
        <circle className="radar-ring radar-ring--middle" cx={CENTRE} cy={CENTRE} r={RING_MIDDLE} />
        <circle className="radar-ring radar-ring--inner" cx={CENTRE} cy={CENTRE} r={RING_INNER} />
        <line
          className="radar-cross"
          x1={CENTRE}
          y1={CENTRE - RING_OUTER}
          x2={CENTRE}
          y2={CENTRE + RING_OUTER}
        />
        <line
          className="radar-cross"
          x1={CENTRE - RING_OUTER}
          y1={CENTRE}
          x2={CENTRE + RING_OUTER}
          y2={CENTRE}
        />
        {view?.left === true && <path className="radar-arc radar-arc--left" d={arcPath("left")} />}
        {view?.right === true && (
          <path className="radar-arc radar-arc--right" d={arcPath("right")} />
        )}
        <g className="radar-player">
          <rect x={player.x} y={player.y} width={player.w} height={player.h} rx={player.rx} />
          <line
            x1={player.x - 4}
            y1={CENTRE}
            x2={Math.round((player.x + player.w + 4) * 100) / 100}
            y2={CENTRE}
          />
        </g>
        {view?.cars.map((car) => (
          <OtherCar key={car.carIdx} car={car} options={options} labels={labels} />
        ))}
      </svg>
    </div>
  );
}
