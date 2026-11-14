import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { optionBoolean } from "../settings";
import "./vehicle-damage.css";
import {
  areaSeverity,
  damageStatus,
  damageView,
  isClean,
  SAMPLE_DAMAGE_VIEW,
  sinceText,
  tyresText,
  worst,
  type DamageView,
  type Severity,
  type WheelId,
  type ZoneId,
} from "./view";

const TEXT: Readonly<Record<Severity, string>> = { ok: "OK", minor: "Minor", heavy: "Heavy" };

/**
 * The body outline split into the eight zones, going round clockwise on screen (nose up, so the
 * car's left is on the left). Each corner zone takes its rounded corner and the start of the two
 * edges next to it.
 */
const EDGES: Readonly<Record<ZoneId, string>> = {
  frontLeft: "M62,60 V40 A12,12 0 0 1 74,28 H82",
  front: "M82,28 H98",
  frontRight: "M98,28 H106 A12,12 0 0 1 118,40 V60",
  right: "M118,60 V92",
  rearRight: "M118,92 V112 A12,12 0 0 1 106,124 H98",
  rear: "M98,124 H82",
  rearLeft: "M82,124 H74 A12,12 0 0 1 62,112 V92",
  left: "M62,92 V60",
};

/** Wheel rectangles and the suspension arm to each, in the 180 x 155 drawing. */
const WHEEL_AT: Readonly<Record<WheelId, { x: number; y: number; arm: string }>> = {
  fl: { x: 36, y: 30, arm: "M48,42 H62" },
  fr: { x: 132, y: 30, arm: "M118,42 H132" },
  rl: { x: 36, y: 96, arm: "M48,108 H62" },
  rr: { x: 132, y: 96, arm: "M118,108 H132" },
};

const BODY_ZONES: readonly ZoneId[] = [
  "frontLeft",
  "left",
  "rearLeft",
  "rearRight",
  "right",
  "frontRight",
];

/** The car from above: wings for the nose and tail zones, the body edge for the rest. */
function CarOutline({ view }: { view: DamageView }) {
  const z = view.zones;
  const body = worst(BODY_ZONES.map((id) => z[id]));
  return (
    <svg className="vd-car" viewBox="0 0 180 155" aria-hidden="true">
      <path
        className={`vd-shape vd-shape--${z.front}`}
        data-part="front-wing"
        d="M55,14 L125,14 L130,26 L50,26 Z"
      />
      <rect className={`vd-body vd-body--${body}`} x="62" y="28" width="56" height="96" rx="12" />
      {(Object.keys(EDGES) as ZoneId[]).map((id) => (
        <path key={id} className={`vd-edge vd-edge--${z[id]}`} data-zone={id} d={EDGES[id]} />
      ))}
      <rect className="vd-cockpit" x="74" y="54" width="32" height="36" rx="6" />
      {(Object.keys(WHEEL_AT) as WheelId[]).map((id) => {
        const w = WHEEL_AT[id];
        const flat = view.tyreFlat[id];
        return (
          <g key={id} data-wheel={id}>
            <path className="vd-arm" d={w.arm} />
            <rect
              className={flat ? "vd-wheel vd-wheel--flat" : "vd-wheel"}
              x={w.x}
              y={w.y}
              width="12"
              height="24"
              rx="2"
            />
          </g>
        );
      })}
      <rect
        className={`vd-shape vd-shape--${z.rear}`}
        data-part="rear-wing"
        x="52"
        y="128"
        width="76"
        height="12"
        rx="2"
      />
    </svg>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="vd-kv">
      <span>{label}</span>
      <b className={`vd-val vd-val--${tone}`}>{value}</b>
    </div>
  );
}

/** Damage panel: a status pill, the car outline in damage colours and a few details. */
export function VehicleDamageOverlay({ settings }: OverlayProps) {
  const { useTelemetry, editing } = useOverlayRuntime();
  const live = useTelemetry(damageView, 5);
  const view = live ?? (editing ? SAMPLE_DAMAGE_VIEW : null);
  if (view === null) return <></>;
  if (!editing && optionBoolean(settings, "hide-clean") && isClean(view)) return <></>;

  const status = damageStatus(view);
  const front = areaSeverity(view.zones, "front");
  const rear = areaSeverity(view.zones, "rear");
  const tyres = tyresText(view.tyreFlat);
  return (
    <div className="vd">
      <div className="vd-head">
        <span className="vd-title">DAMAGE STATUS</span>
        <span className={`vd-pill vd-pill--${status.tone}`}>{status.text}</span>
      </div>
      <div className="vd-stage">
        <CarOutline view={view} />
      </div>
      {optionBoolean(settings, "show-details") ? (
        <div className="vd-details">
          <Detail label="Front" value={TEXT[front]} tone={front} />
          <Detail label="Rear" value={TEXT[rear]} tone={rear} />
          <Detail label="Tyres" value={tyres} tone={tyres === "OK" ? "ok" : "heavy"} />
          <Detail label="Last hit" value={sinceText(view.sinceImpactS)} tone="plain" />
        </div>
      ) : null}
    </div>
  );
}
