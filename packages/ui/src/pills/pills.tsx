import type { CSSProperties } from "react";
import { formatIRating, licenceColourVar, parseLicence } from "../format/licence";
import { licenceTextColour, readableTextColour } from "./colour";
import "./pills.css";

export function LicencePill({ licence }: { licence: string | null }): JSX.Element {
  const { licenceClass, safetyRating } = parseLicence(licence);
  const style: CSSProperties = {
    background: licenceColourVar(licenceClass),
    color: licenceClass === null ? "var(--ov-bg)" : licenceTextColour(licenceClass),
  };
  const text =
    licenceClass === null
      ? "--"
      : safetyRating === null
        ? licenceClass
        : `${licenceClass} ${safetyRating.toFixed(2)}`;
  return (
    <span className="ov-pill ov-pill--licence" style={style}>
      {text}
    </span>
  );
}

export function IRatingPill({
  iRating,
  licence,
  tinted,
}: {
  iRating: number | null;
  licence?: string | null;
  tinted: boolean;
}): JSX.Element {
  const { licenceClass } = parseLicence(licence ?? null);
  const style: CSSProperties | undefined =
    tinted && licenceClass !== null
      ? { background: licenceColourVar(licenceClass), color: licenceTextColour(licenceClass) }
      : undefined;
  return (
    <span className={`ov-pill ov-pill--irating${style ? "" : " ov-pill--plain"}`} style={style}>
      {formatIRating(iRating)}
    </span>
  );
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
