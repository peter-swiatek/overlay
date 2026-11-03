import type { CSSProperties } from "react";
import { formatIRating, licenceColourVar, parseLicence } from "../format/licence";
import { licenceTextColour, readableTextColour } from "./colour";
import { HELMET_PATH } from "./helmet";
import "./pills.css";

export function LicencePill({ licence }: { licence: string | null }): JSX.Element {
  const { licenceClass, safetyRating } = parseLicence(licence);
  if (licenceClass === null) return <span className="ov-pill ov-pill--plain">--</span>;
  const cls = licenceClass === "P" ? "pro" : licenceClass.toLowerCase();
  const sr = safetyRating === null ? null : safetyRating.toFixed(2);
  return (
    <span
      className={`ov-pill ov-pill--lic-${cls}`}
      aria-label={`Licence ${licenceClass}${sr === null ? "" : ` ${sr}`}`}
    >
      <span className="ov-lic-ltr">{licenceClass}</span>
      {sr !== null && <span className="ov-lic-num">{sr}</span>}
    </span>
  );
}

export function IRatingPill({
  iRating,
  licence,
  tinted,
  change,
}: {
  iRating: number | null;
  licence?: string | null;
  tinted: boolean;
  /** Signed projected/actual change; null, 0 or non-finite shows no delta. */
  change?: number | null;
}): JSX.Element {
  const { licenceClass } = parseLicence(licence ?? null);
  const style: CSSProperties | undefined =
    tinted && licenceClass !== null
      ? { background: licenceColourVar(licenceClass), color: licenceTextColour(licenceClass) }
      : undefined;
  const rounded = change === null || change === undefined ? 0 : Math.round(change);
  const showDelta = Number.isFinite(rounded) && rounded !== 0;
  return (
    <span className={`ov-pill ov-pill--ir${style ? " ov-pill--ir-tinted" : ""}`} style={style}>
      <span className="ov-ir-val">{formatIRating(iRating)}</span>
      {showDelta && (
        <span className={`ov-ir-delta ov-ir-delta--${rounded > 0 ? "up" : "down"}`}>
          <span className="ov-ir-tri">{rounded > 0 ? "\u25B2" : "\u25BC"}</span>
          {Math.abs(rounded)}
        </span>
      )}
    </span>
  );
}

export function CarCount({ count }: { count: number }): JSX.Element {
  return (
    <span className="ov-car-count" aria-label={`${count} ${count === 1 ? "car" : "cars"}`}>
      {count}
      <svg className="ov-helmet" viewBox="0 0 362 376" aria-hidden="true" focusable="false">
        <path fillRule="evenodd" d={HELMET_PATH} />
      </svg>
    </span>
  );
}

export type FlagBadgeKind = "yel" | "pit" | "dsq" | "blk" | "dmg";

const FLAG_LABELS: Record<FlagBadgeKind, string> = {
  yel: "YEL",
  pit: "PIT",
  dsq: "DSQ",
  blk: "BLK",
  dmg: "DMG",
};

export function FlagBadge({ kind }: { kind: FlagBadgeKind }): JSX.Element {
  return <span className={`ov-badge-flag ov-badge-flag--${kind}`}>{FLAG_LABELS[kind]}</span>;
}

export function CarNumberBadge({ carNumber }: { carNumber: string | null }): JSX.Element {
  return <span className="ov-car-num">{carNumber === null ? "--" : `#${carNumber}`}</span>;
}

export function ClassBadge({ name, colour }: { name: string; colour: string | null }): JSX.Element {
  const style: CSSProperties | undefined = colour
    ? { background: colour, color: readableTextColour(colour) }
    : undefined;
  return (
    <span className={`ov-pill ov-pill--class${style ? "" : " ov-pill--plain"}`} style={style}>
      {name}
    </span>
  );
}

export function PositionDelta({ delta }: { delta: number | null }): JSX.Element {
  if (delta === null || delta === 0 || !Number.isFinite(delta)) {
    return <span className="ov-delta ov-delta--none">–</span>;
  }
  const gained = delta > 0;
  return (
    <span className={`ov-delta ${gained ? "ov-delta--gain" : "ov-delta--loss"}`}>
      {gained ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}
