import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { OverlayProps } from "../module";
import { optionBoolean } from "../settings";
import { useOverlayRuntime } from "../runtime";
import { dotColour } from "../track-map/view";
import "./flat-track-map.css";
import {
  barLabels,
  DEFAULT_BAR_EM,
  flatLive,
  innerBoundaries,
  orderCars,
  playerLabel,
  SAMPLE_CARS,
  SAMPLE_SECTOR_STARTS,
  sectorLabels,
  type BarLabel,
  type FlatCar,
} from "./view";

const at = (pct: number): string => `${Math.round(pct * 10000) / 100}%`;

/** The bar's width in ems of its own font size; the default size until it has been measured. */
function useBarEm(ref: RefObject<HTMLDivElement>): number {
  const [barEm, setBarEm] = useState(DEFAULT_BAR_EM);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const read = (): void => {
      const px = parseFloat(getComputedStyle(el).fontSize);
      // clientWidth is layout px of the same subtree as the font size, so zoom cancels out.
      if (px > 0 && el.clientWidth > 0) {
        const next = Math.round((el.clientWidth / px) * 10) / 10;
        setBarEm((prev) => (prev === next ? prev : next));
      }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return barEm;
}

function CarDot({ car }: { car: FlatCar }) {
  const style = { left: at(car.pct), "--flat-track-map-class": dotColour(car.colour) };
  if (car.player) {
    return (
      <span
        className="flat-track-map-car flat-track-map-car--player"
        style={style as CSSProperties}
      >
        <span className="flat-track-map-player-dot" />
      </span>
    );
  }
  const tone = car.flag ? " flat-track-map-car--flag" : car.pit ? " flat-track-map-car--pit" : "";
  return <span className={`flat-track-map-car${tone}`} style={style as CSSProperties} />;
}

function Label({ label }: { label: BarLabel }) {
  return (
    <span
      className={`flat-track-map-label flat-track-map-label--${label.kind} flat-track-map-label--${label.anchor}`}
      style={{ left: at(label.pct) }}
    >
      {label.text}
    </span>
  );
}

/** One lap as a straight bar: start/finish at the left, sector ticks, every car on it. */
export function FlatTrackMapOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const live = runtime.useTelemetry(flatLive, 15);
  const ref = useRef<HTMLDivElement>(null);
  const barEm = useBarEm(ref);

  // Edit mode and the settings preview draw the sample until there are cars to show.
  const sample =
    live.cars.length === 0 && (runtime.editing || runtime.useTrackOutline === undefined);
  const cars = sample ? SAMPLE_CARS : live.cars;
  const starts = sample ? SAMPLE_SECTOR_STARTS : live.sectorStartPcts;

  const showLabels = optionBoolean(settings, "labels");
  const showTicks = optionBoolean(settings, "sector-ticks");
  const showPlayer = optionBoolean(settings, "player-label");

  const ticks = showTicks ? innerBoundaries(starts) : [];
  // Sector names label the ticks, so they go with them; S/F stays with the labels setting.
  const sectors = showLabels
    ? sectorLabels(starts).filter((l) => l.kind === "start" || showTicks)
    : [];
  const player = cars.find((c) => c.player) ?? null;
  const labels = barLabels(
    sectors,
    showPlayer && player !== null ? playerLabel(player, barEm) : null,
    barEm,
  );

  return (
    <div className={`flat-track-map${sample ? " flat-track-map--sample" : ""}`}>
      <div className="flat-track-map-bar" ref={ref}>
        <span className="flat-track-map-line" />
        <span className="flat-track-map-tick flat-track-map-tick--start" />
        {ticks.map((pct) => (
          <span
            key={pct}
            className="flat-track-map-tick flat-track-map-tick--sector"
            style={{ left: at(pct) }}
          />
        ))}
        {orderCars(cars).map((car) => (
          <CarDot key={car.carIdx} car={car} />
        ))}
      </div>
      {labels.length > 0 && (
        <div className="flat-track-map-labels">
          {labels.map((l) => (
            <Label key={`${l.kind}-${l.text}`} label={l} />
          ))}
        </div>
      )}
    </div>
  );
}
