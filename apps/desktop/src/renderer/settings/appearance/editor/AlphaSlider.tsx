import { useEffect, useRef, useState } from "react";
import { alphaPercentOf, withAlphaPercent } from "./alpha";

/**
 * Alpha 0..100 % for a "#rrggbb[aa]" colour. The shown value follows dragging locally; the
 * colour is committed once, on release (DOM "change"), blur or key release.
 */
export function AlphaSlider({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit(next: string): void;
  label: string;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const localRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useRef((): void => {
    const pct = localRef.current;
    localRef.current = null;
    setLocal(null);
    if (pct === null) return;
    const next = withAlphaPercent(valueRef.current, pct);
    if (next !== valueRef.current) commitRef.current(next);
  }).current;

  useEffect(() => {
    // React's onChange follows every "input" event; the native "change" fires on release.
    const el = inputRef.current;
    el?.addEventListener("change", commit);
    return () => el?.removeEventListener("change", commit);
  }, [commit]);

  const shown = local ?? alphaPercentOf(value);
  return (
    <span className="ctl-slider">
      <input
        ref={inputRef}
        type="range"
        aria-label={label}
        min={0}
        max={100}
        step={1}
        value={shown}
        onChange={(e) => {
          localRef.current = Number(e.target.value);
          setLocal(localRef.current);
        }}
        onBlur={commit}
        onKeyUp={commit}
      />
      <output>{shown} %</output>
    </span>
  );
}
