import type { SimName } from "@overlay/sim-core/types";
import { formatSpeed, formatTemperature } from "@overlay/ui/format";
import type { ReactNode } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { visibleFields } from "../settings";
import { weatherManifest } from "./manifest";
import { EDIT_SAMPLE, weatherView, type WeatherView } from "./view";
import "./weather.css";

// Weather is a reference panel, not a driving aid: without live data it shows "--" values, and
// the fixed sample only while editing.

const ICONS: Record<string, ReactNode> = {
  wind: (
    <>
      <path d="M2 6h8a2 2 0 1 0-2-2" />
      <path d="M2 9.5h10.5a2 2 0 1 1-2 2" />
      <path d="M2 13h5" />
    </>
  ),
  "track-temp": <path d="M5 2 L2 14 M11 2 L14 14 M8 3 V5 M8 7.5 V9.5 M8 12 V14" />,
  "air-temp": (
    <>
      <path d="M6.5 9.6V3a1.5 1.5 0 0 1 3 0v6.6a3 3 0 1 1-3 0Z" />
      <path d="M8 7v4" />
    </>
  ),
  humidity: <path d="M8 2.2c2.6 3.1 4 5.3 4 7.2a4 4 0 0 1-8 0c0-1.9 1.4-4.1 4-7.2Z" />,
  rain: (
    <>
      <path d="M4.5 9.5a3 3 0 0 1 .4-6 3.8 3.8 0 0 1 7 1.4 2.4 2.4 0 0 1-.4 4.6Z" />
      <path d="M5.5 11.5 4.8 13.5 M8.5 11.5 7.8 13.5 M11.5 11.5 10.8 13.5" />
    </>
  ),
  usage: (
    <>
      <path d="M5 2 L2 14 M11 2 L14 14" />
      <path d="M5.5 10.5c1-.8 4-.8 5 0" />
      <path d="M6.2 7c.7-.5 2.9-.5 3.6 0" />
    </>
  ),
  wetness: (
    <>
      <path d="M3.5 13.5 5.5 2.5 M12.5 13.5 10.5 2.5" />
      <path d="M8 6.2c1.2 1.4 1.8 2.4 1.8 3.2a1.8 1.8 0 0 1-3.6 0c0-.8.6-1.8 1.8-3.2Z" />
    </>
  ),
};

const ROW_IDS = ["track-temp", "air-temp", "wind", "humidity", "rain", "usage"];
const KEYS: Record<string, string> = {
  "track-temp": "Track temp",
  "air-temp": "Air temp",
  wind: "Wind",
  humidity: "Humidity",
  rain: "Rain",
  usage: "Usage",
};

const WETNESS_TEXT = { dry: "Dry", damp: "Damp", wet: "Wet" } as const;

function Icon({ id }: { id: string }) {
  return (
    <svg className="wx-ico" viewBox="0 0 16 16" aria-hidden="true">
      {ICONS[id]}
    </svg>
  );
}

const pct = (v: number | null): string => (v === null ? "--" : String(Math.round(v * 100)));

/** Fields the sim has: the manifest marks the iRacing-only ones. Unknown sim keeps all. */
function availableIn(id: string, sim: SimName | null): boolean {
  if (sim === null) return true;
  const sims = weatherManifest.fields.find((f) => f.id === id)?.sims;
  return sims === undefined || sims.includes(sim);
}

function Compass({ v, label }: { v: WeatherView; label: string }) {
  return (
    <svg width="104" height="104" viewBox="-52 -52 104 104" role="img" aria-label={label}>
      <circle r="46" className="wx-compass-disc" />
      <circle r="34" className="wx-compass-ring" />
      <g style={{ transform: `rotate(${v.dialDeg ?? 0}deg)` }}>
        <path d="M0,-50 L-5,-58 L5,-58 Z" className="wx-north" />
        <text
          x="0"
          y="-36"
          textAnchor="middle"
          dominantBaseline="middle"
          className="wx-letter wx-letter-n"
        >
          N
        </text>
        {(
          [
            ["E", 90],
            ["S", 180],
            ["W", 270],
          ] as const
        ).map(([t, r]) => (
          <text
            key={t}
            x="0"
            y="-36"
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${r})`}
            className="wx-letter"
          >
            {t}
          </text>
        ))}
      </g>
      {v.arrowDeg !== null && (
        <g style={{ transform: `rotate(${v.arrowDeg}deg)` }}>
          <path d="M0,-24 L9,-8 L3,-10 L3,20 L-3,20 L-3,-10 L-9,-8 Z" className="wx-arrow" />
        </g>
      )}
    </svg>
  );
}

export function WeatherOverlay({ settings }: OverlayProps) {
  const { useTelemetry, prefs, editing } = useOverlayRuntime();
  const live = useTelemetry(weatherView, 10);
  const sim = useTelemetry((f) => f?.state.sim ?? null, 10);
  const sample = !live.live && editing;
  const v: WeatherView = sample ? EDIT_SAMPLE : live;

  const configured = visibleFields(settings)
    .map((f) => f.id)
    .filter((id) => availableIn(id, sample ? null : sim));
  const ids = new Set(configured);
  // A live frame without heading (LMU) has no compass; no data at all keeps the empty dial.
  const showCompass = ids.has("compass") && (!v.live || v.dialDeg !== null);
  const wind = formatSpeed(v.windSpeedMps, prefs, 0);
  const track = formatTemperature(v.trackTempC, prefs, 0);
  const air = formatTemperature(v.airTempC, prefs, 0);
  const windLabel = `Wind ${wind.value} ${wind.unit}${v.windFrom === null ? "" : ` from ${v.windFrom}`}`;

  const rowValue = (id: string): string => {
    switch (id) {
      case "track-temp":
        return `${track.value} ${track.unit}`;
      case "air-temp":
        return `${air.value} ${air.unit}`;
      case "wind":
        return `${wind.value} ${wind.unit}`;
      case "humidity":
        return `${pct(v.humidity)} %`;
      case "rain":
        return `${pct(v.precipitation)} %`;
      default:
        return v.usage ?? "--";
    }
  };
  const rows = configured.filter((id) => ROW_IDS.includes(id));

  return (
    <div className="panel wx-panel">
      {showCompass && (
        <div className="wx-compass">
          <Compass v={v} label={windLabel} />
          <div className="wx-speed">
            <Icon id="wind" />
            <span>{wind.value}</span>
            <small>{wind.unit}</small>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="wx-rows">
          {rows.map((id) => (
            <div key={id} className="wx-row">
              <span className="wx-ico-cell">
                <Icon id={id} />
              </span>
              <span className="wx-key">{KEYS[id]}</span>
              <span className="wx-val">{rowValue(id)}</span>
            </div>
          ))}
        </div>
      )}
      {ids.has("wetness") && (
        <div className="wx-wet">
          <div
            className="wx-well"
            role="img"
            aria-label={`Track wetness ${pct(v.wetness)} percent`}
          >
            <i
              className="wx-fill"
              style={{ width: `${v.wetness === null ? 0 : pct(v.wetness)}%` }}
            />
          </div>
          <div className="wx-wet-label">
            <span>
              <Icon id="wetness" />
              Track
            </span>
            <span className={v.wetnessLabel === "wet" ? "wx-wet-wet" : undefined}>
              {v.wetnessLabel === null ? "--" : WETNESS_TEXT[v.wetnessLabel]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
