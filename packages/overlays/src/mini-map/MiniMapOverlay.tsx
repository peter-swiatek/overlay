import type { CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { optionBoolean, optionNumber, optionString } from "../settings";
import { useOverlayRuntime } from "../runtime";
import { SAMPLE_TRACK, useSampleTrack } from "../track-map/sample";
import { dotColour } from "../track-map/view";
import "./mini-map.css";
import {
  CENTRE,
  headerText,
  headingAt,
  miniFrame,
  miniLive,
  placeMiniCars,
  PLAYER_X,
  PLAYER_Y,
  RING_INNER,
  RING_OUTER,
  roadPath,
  SAMPLE_MINI_CARS,
  SAMPLE_PLAYER_PCT,
  VIEW,
  type MiniCar,
  type MiniOptions,
  type PlacedMiniCar,
} from "./view";

/** Shown until the outline is learned (after the first full lap), like the Track Map note. */
export const NO_OUTLINE_NOTE = "Learning the track…";

function CarDot({ car }: { car: PlacedMiniCar }) {
  const flagged = car.status === "off" || car.status === "slow";
  const tone = flagged ? "flag" : car.threat ? "threat" : "class";
  const style = { "--mini-map-class": dotColour(car.colour) } as CSSProperties;
  return (
    <g
      className={`mini-map-car mini-map-car--${tone}${car.status === "pit" ? " mini-map-car--pit" : ""}`}
      style={style}
    >
      <circle className="mini-map-dot" cx={car.x} cy={car.y} r={flagged ? 7 : 6} />
      {car.label !== null && (
        <text className="mini-map-label" x={car.labelX} y={car.labelY} textAnchor={car.anchor}>
          {car.label}
        </text>
      )}
    </g>
  );
}

/** The player: the Track Map's blue ring with an arrow in the direction of travel. */
function PlayerMark({ rotateDeg }: { rotateDeg: number }) {
  const turn =
    Math.abs(rotateDeg) < 0.5 ? undefined : `rotate(${rotateDeg} ${PLAYER_X} ${PLAYER_Y})`;
  return (
    <g className="mini-map-player">
      <circle className="mini-map-player-ring" cx={PLAYER_X} cy={PLAYER_Y} r={11} />
      <polygon
        className="mini-map-player-arrow"
        points={`${PLAYER_X},${PLAYER_Y - 8} ${PLAYER_X - 6},${PLAYER_Y + 6} ${PLAYER_X + 6},${PLAYER_Y + 6}`}
        transform={turn}
      />
    </g>
  );
}

/** A heading-up (or north-up) local map around the player with nearby cars and their gaps. */
export function MiniMapOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const { useTelemetry, editing } = runtime;
  const live = useTelemetry(miniLive, 15);
  const useOutline = runtime.useTrackOutline ?? useSampleTrack;
  const fetched = useOutline(live.trackKey, live.outlineReady);
  const options: MiniOptions = {
    zoomPct: optionNumber(settings, "zoom"),
    headingUp: optionString(settings, "orientation") !== "north-up",
    labels: optionBoolean(settings, "car-labels"),
    gaps: optionBoolean(settings, "gap"),
  };

  // Hosts that cannot fetch outlines (the settings preview) and edit mode before the outline is
  // known draw the sample; while driving without an outline only the note shows.
  const demo = runtime.useTrackOutline === undefined || (fetched === null && editing);
  const outline = demo ? SAMPLE_TRACK.outline : (fetched?.outline ?? null);
  const playerPct = demo ? SAMPLE_PLAYER_PCT : live.playerPct;
  const cars: readonly MiniCar[] = demo ? SAMPLE_MINI_CARS : live.cars;
  const note = fetched === null && runtime.useTrackOutline !== undefined;

  let road = "";
  let placed: PlacedMiniCar[] = [];
  let arrowDeg = 0;
  if (outline !== null && playerPct !== null) {
    const frame = miniFrame(outline, playerPct, options);
    road = roadPath(outline, frame);
    placed = placeMiniCars(outline, frame, cars, options);
    if (!options.headingUp) {
      const [fx, fy] = headingAt(outline, playerPct);
      arrowDeg = Math.round((Math.atan2(fx, -fy) * 180) / Math.PI);
    }
  }

  return (
    <div className="mini-map">
      <svg
        className="mini-map-svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label="Mini map"
      >
        <circle
          className="mini-map-ring mini-map-ring--outer"
          cx={CENTRE}
          cy={CENTRE}
          r={RING_OUTER}
        />
        <circle
          className="mini-map-ring mini-map-ring--inner"
          cx={CENTRE}
          cy={CENTRE}
          r={RING_INNER}
        />
        {road !== "" && (
          <>
            <path className="mini-map-road-casing" d={road} />
            <path className="mini-map-road" d={road} />
          </>
        )}
        {placed.map((car) => (
          <CarDot key={car.carIdx} car={car} />
        ))}
        {playerPct !== null && outline !== null && <PlayerMark rotateDeg={arrowDeg} />}
        {note && (
          <text className="mini-map-note" x={CENTRE} y={demo ? VIEW - 10 : CENTRE}>
            {NO_OUTLINE_NOTE}
          </text>
        )}
      </svg>
      <div className="mini-map-header">{headerText(options)}</div>
    </div>
  );
}
