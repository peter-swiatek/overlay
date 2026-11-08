import { useMemo } from "react";
import type { OverlayProps } from "../module";
import { optionBoolean } from "../settings";
import { useOverlayRuntime } from "../runtime";
import "./track-map.css";
import { SAMPLE_CARS, SAMPLE_SECTOR_STARTS, SAMPLE_TRACK, useSampleTrack } from "./sample";
import {
  cornerLabels,
  dotColour,
  mapLive,
  mapShape,
  mapTicks,
  NOTE_RESERVE,
  placeCars,
  VIEW_H,
  VIEW_W,
  type PlacedCar,
} from "./view";

export const NO_OUTLINE_NOTE = "Track map appears after your first lap";

function CarMark({ car, numbers }: { car: PlacedCar; numbers: boolean }) {
  const fill = { fill: dotColour(car.colour) };
  const num = numbers ? car.label : null;
  if (car.player) {
    return (
      <g className="track-map-car track-map-car--player">
        <circle className="track-map-player-ring" cx={car.x} cy={car.y} r={9} />
        <circle className="track-map-player-dot" cx={car.x} cy={car.y} r={5.5} style={fill} />
        <text className="track-map-player-label" x={car.x} y={car.y - 12}>
          {num === null ? "YOU" : `${num} YOU`}
        </text>
      </g>
    );
  }
  if (car.slow) {
    return (
      <g className="track-map-car track-map-car--slow">
        <circle className="track-map-slow-ring" cx={car.x} cy={car.y} r={7} />
        <circle className="track-map-dot track-map-dot--slow" cx={car.x} cy={car.y} r={5.5} />
        <text className="track-map-slow-label" x={car.x} y={car.y + 17}>
          {num === null ? "YLW" : `${num} YLW`}
        </text>
      </g>
    );
  }
  return (
    <g className={`track-map-car${car.pit ? " track-map-car--pit" : ""}`}>
      <circle className="track-map-dot" cx={car.x} cy={car.y} r={5.5} style={fill} />
      {num !== null && (
        <text className="track-map-label" x={car.x} y={car.y - 8.5}>
          {num}
        </text>
      )}
    </g>
  );
}

/** The track outline with every car on it; frameless, like the spotter. */
export function TrackMapOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const { useTelemetry, editing } = runtime;
  const live = useTelemetry(mapLive, 15);
  const useOutline = runtime.useTrackOutline ?? useSampleTrack;
  const fetched = useOutline(live.trackKey, live.outlineReady);

  const sample = fetched === null;
  const track = fetched ?? SAMPLE_TRACK;
  const shape = useMemo(
    () => mapShape(track.outline, sample ? NOTE_RESERVE : 0),
    [track.outline, sample],
  );
  const showCorners = optionBoolean(settings, "corner-labels");
  const numbers = optionBoolean(settings, "car-numbers");
  const corners = useMemo(
    () => (showCorners ? cornerLabels(shape, track.corners) : []),
    [shape, track.corners, showCorners],
  );

  // No outline yet: nothing while driving; the sample with a note while editing.
  if (sample && !editing) return null;

  const ticks = mapTicks(shape, sample ? SAMPLE_SECTOR_STARTS : live.sectorStartPcts);
  const cars = placeCars(shape, sample ? SAMPLE_CARS : live.cars);

  return (
    <div className={`track-map${sample ? " track-map--sample" : ""}`}>
      <svg
        className="track-map-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Track map"
      >
        <path className="track-map-casing" d={shape.path} />
        <path className="track-map-surface" d={shape.path} />
        {ticks.map((t, i) => (
          <line
            key={i}
            className={`track-map-tick track-map-tick--${t.kind}`}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
          />
        ))}
        {corners.map((c) => (
          <text key={c.text} className="track-map-corner" x={c.x} y={c.y} dy="0.35em">
            {c.text}
          </text>
        ))}
        {cars.map((car) => (
          <CarMark key={car.carIdx} car={car} numbers={numbers} />
        ))}
        {sample && (
          <text className="track-map-note" x={VIEW_W / 2} y={VIEW_H - 8}>
            {NO_OUTLINE_NOTE}
          </text>
        )}
      </svg>
    </div>
  );
}
