import type { OverlayManifest } from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import type { FieldConfig } from "@overlay/ui/types";
import { useState } from "react";
import { Row, Section, Slider, Toggle } from "../controls";
import { fieldDef, moveField, setFieldPatch, shownWidthPct, simState } from "./model";

/**
 * The Columns (table overlays) or Fields (other overlays) section of the overlay panel.
 * Owned by MW-6; mounted by OverlayPanel with exactly these props.
 */
export interface ColumnEditorProps {
  manifest: OverlayManifest;
  fields: readonly FieldConfig[];
  sim: SimName;
  onFields(next: FieldConfig[]): void;
  /** Width slider changes: debounced by the caller. */
  onWidth(next: FieldConfig[]): void;
}

export function ColumnEditor({ manifest, fields, sim, onFields, onWidth }: ColumnEditorProps) {
  const table = manifest.table;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  return (
    <Section title={table ? "Columns" : "Fields"}>
      {fields.map((config, index) => {
        const def = fieldDef(manifest, config.id);
        const label = def?.label ?? config.id;
        const state = simState(def?.sims, sim);
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
              value={shownWidthPct(config, def)}
              min={1}
              max={100}
              step={1}
              unit="%"
              disabled={state.disabled}
              onChange={(widthPct) => onWidth(setFieldPatch(fields, config.id, { widthPct }))}
            />
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
      {table && <p className="muted ov-note">Widths apply when Column width is Custom.</p>}
    </Section>
  );
}
