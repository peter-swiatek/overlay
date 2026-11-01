import type { OverlayManifest } from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import type { FieldConfig } from "@overlay/ui/types";
import { useState } from "react";
import { Row, Section, Slider, Toggle } from "../controls";
import {
  floorPctFor,
  planWidthChange,
  sliderValue,
  totalMessage,
  widthTotal,
  type FloorInputs,
  type WidthMode,
} from "./columns-model";
import { fieldDef, moveField, setFieldPatch, simState } from "./model";
import "./columns.css";

/**
 * The Columns (table overlays) or Fields (other overlays) section of the overlay panel.
 * Owned by MW-6; mounted by OverlayPanel with exactly these props.
 */
export interface ColumnEditorProps {
  manifest: OverlayManifest;
  fields: readonly FieldConfig[];
  sim: SimName | null;
  onFields(next: FieldConfig[]): void;
  /** Width slider changes: debounced by the caller. */
  onWidth(next: FieldConfig[]): void;
  /**
   * Width slider change while Column width is Auto or Compact. The caller must send ONE patch with
   * both `common.fields = next` and `options["column-width"] = "custom"` (`customWidthPatch`). When omitted, `onWidth`
   * is used and the mode is left alone.
   */
  onWidthCustom?(next: FieldConfig[]): void;
  /** Current Column width option. Unknown (omitted): the old "Widths apply when..." note is shown. */
  widthMode?: WidthMode;
  /** From the preview's measurement. Without them the overlay's window width and 7 px per ch are used. */
  tableWidthPx?: number;
  chPx?: number;
  cellPadPx?: number;
  /** The Fine-tune option (width scale), percent. Default 100. */
  widthScalePct?: number;
}

export function ColumnEditor({
  manifest,
  fields,
  sim,
  onFields,
  onWidth,
  onWidthCustom,
  widthMode,
  tableWidthPx,
  chPx,
  cellPadPx,
  widthScalePct,
}: ColumnEditorProps) {
  const table = manifest.table;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [switched, setSwitched] = useState(false);
  const floorInputs: FloorInputs = { tableWidthPx, chPx, cellPadPx, widthScalePct };
  const changeWidth = (id: string, widthPct: number): void => {
    const plan = planWidthChange(fields, id, widthPct, widthMode);
    if (plan.setCustom && onWidthCustom) {
      setSwitched(true);
      onWidthCustom(plan.fields);
    } else {
      onWidth(plan.fields);
    }
  };
  return (
    <Section title={table ? "Columns" : "Fields"}>
      {fields.map((config, index) => {
        const def = fieldDef(manifest, config.id);
        const label = def?.label ?? config.id;
        const state = simState(def?.sims, sim);
        const floor = floorPctFor(manifest, config.id, floorInputs);
        if (!table) {
          return (
            <Row key={config.id} label={label} disabled={state.disabled} badge={state.badge}>
              <Toggle
                label={`Show ${label}`}
                checked={config.visible}
                disabled={state.disabled && !config.visible}
                onChange={(visible) => onFields(setFieldPatch(fields, config.id, { visible }))}
              />
            </Row>
          );
        }
        return (
          <div
            key={config.id}
            className="ov-col"
            aria-disabled={state.disabled || undefined}
            onDragOver={(e) => {
              if (dragFrom !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) onFields(moveField(fields, dragFrom, index));
              setDragFrom(null);
            }}
          >
            <span
              className="ov-handle"
              draggable
              title="Drag to reorder"
              aria-hidden="true"
              onDragStart={() => setDragFrom(index)}
              onDragEnd={() => setDragFrom(null)}
            >
              ⠿
            </span>
            <span className="ov-col-label">
              {label}
              {state.badge && <em className="ctl-badge">{state.badge}</em>}
            </span>
            <Toggle
              label={`Show ${label}`}
              checked={config.visible}
              disabled={state.disabled && !config.visible}
              onChange={(visible) => onFields(setFieldPatch(fields, config.id, { visible }))}
            />
            <span className="ov-col-moves">
              <button
                type="button"
                aria-label={`Move up ${label}`}
                disabled={index === 0}
                onClick={() => onFields(moveField(fields, index, index - 1))}
              >
                Move up
              </button>
              <button
                type="button"
                aria-label={`Move down ${label}`}
                disabled={index === fields.length - 1}
                onClick={() => onFields(moveField(fields, index, index + 1))}
              >
                Move down
              </button>
            </span>
            <Slider
              label={`Width of ${label}`}
              value={sliderValue(config, manifest, floor)}
              min={floor}
              max={100}
              step={1}
              unit="%"
              disabled={state.disabled}
              onChange={(widthPct) => changeWidth(config.id, widthPct)}
            />
            {floor > 1 && (
              <span className="ov-col-floor muted" title="Narrowest readable width">
                min {floor}%
              </span>
            )}
            <button
              type="button"
              aria-label={`Default width of ${label}`}
              disabled={config.widthPct === null}
              onClick={() => onFields(setFieldPatch(fields, config.id, { widthPct: null }))}
            >
              Default
            </button>
          </div>
        );
      })}
      {table && (
        <p className="muted ov-note">
          {widthMode === undefined
            ? "Widths apply when Column width is Custom."
            : totalMessage(widthTotal(manifest, fields, widthScalePct))}
        </p>
      )}
      {table && widthMode !== undefined && (
        <p className="muted ov-note">Narrowest readable width is marked on each slider.</p>
      )}
      {table && switched && widthMode === "custom" && (
        <p className="muted ov-note" role="status">
          Column width set to Custom
        </p>
      )}
    </Section>
  );
}
