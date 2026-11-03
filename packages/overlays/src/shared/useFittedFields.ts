import { columnsToHide, withHidden, type FitColumn } from "@overlay/ui/fit";
import type { ColumnWidthMode, FieldConfig } from "@overlay/ui/types";
import { createElement, useEffect, useMemo, useRef, useState, type RefObject } from "react";

export interface FittedFields {
  /** Attach to the overlay root: the element whose width the table fills. */
  ref: RefObject<HTMLDivElement>;
  /** `fields` with the columns that do not fit set to visible: false. */
  fields: FieldConfig[];
  /** Hidden ids in hide order; the overlay writes them to its root as data-hidden-columns="a b". */
  hiddenIds: string[];
}

interface Measure {
  widthPx: number;
  chPx: number;
  cellPadPx: number;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Hides columns by drop priority while the root is narrower than the visible columns' floors.
 * Needs a `<ChProbe/>` inside the root. Without a measurement (first render, node tests) nothing is hidden.
 */
export function useFittedFields(
  fields: readonly FieldConfig[],
  columns: readonly FitColumn[],
  mode: ColumnWidthMode,
  fineTunePct: number,
): FittedFields {
  const ref = useRef<HTMLDivElement>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    let alive = true;
    const read = (): void => {
      if (!alive) return;
      const probe = root.querySelector<HTMLElement>(".ov-ch-probe");
      if (probe === null) return;
      // clientWidth and offsetWidth are layout px of the same zoomed subtree, so zoom and the
      // preview's transform cancel out. Never use getBoundingClientRect here.
      const pad = parseFloat(getComputedStyle(probe).getPropertyValue("--ov-cell-pad-x"));
      const next: Measure = {
        widthPx: root.clientWidth,
        chPx: probe.offsetWidth / 10,
        cellPadPx: Number.isFinite(pad) ? pad : 7,
      };
      if (!(next.widthPx > 0) || !(next.chPx > 0)) return;
      setMeasure((prev) =>
        prev !== null &&
        prev.widthPx === next.widthPx &&
        prev.chPx === next.chPx &&
        prev.cellPadPx === next.cellPadPx
          ? prev
          : next,
      );
    };
    read();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(root);
    void document.fonts?.ready.then(read);
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, []);

  const computed = useMemo(
    () =>
      measure === null
        ? []
        : columnsToHide(columns, fields, measure.widthPx, mode, fineTunePct, {
            chPx: measure.chPx,
            cellPadPx: measure.cellPadPx,
          }),
    [measure, columns, fields, mode, fineTunePct],
  );
  // Keep the previous array while the list is unchanged so consumers do not re-render.
  const hiddenRef = useRef<string[]>([]);
  if (!sameIds(hiddenRef.current, computed)) hiddenRef.current = computed;
  const hiddenIds = hiddenRef.current;

  const fitted = useMemo(() => withHidden(fields, hiddenIds), [fields, hiddenIds]);
  return { ref, fields: fitted, hiddenIds };
}

/** Hidden probe the hook measures `ch` and --ov-cell-pad-x from; render it inside the root. */
export function ChProbe(): JSX.Element {
  return createElement("span", { className: "ov-ch-probe", "aria-hidden": true });
}
