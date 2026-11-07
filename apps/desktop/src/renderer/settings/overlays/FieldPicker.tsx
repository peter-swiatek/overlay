import type { SettingField } from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import {
  addPick,
  movePick,
  pickCounter,
  removePick,
  reorderPick,
  simState,
  type SimContext,
} from "./model";

type MultiField = Extract<SettingField, { kind: "multi" }>;

/**
 * The picker for every `kind: "multi"` setting (header and footer fields): the picks as chips in
 * order (drag or use the arrows), and a checkbox for every option with a "3 of 5" counter.
 * Owned by MW-5; OverlayPanel mounts it with exactly these props.
 */
export interface FieldPickerProps {
  field: MultiField;
  values: readonly string[];
  /** The sim to grey for; null greys nothing. */
  sim: SimName | null;
  disabled: boolean;
  onChange(next: readonly string[]): void;
}

/** Options for a Select; sim-limited ones are disabled unless they are already picked. */
export function optionList(
  options: readonly { value: string; label: string; sims?: readonly SimName[] }[],
  sim: SimContext,
  keep: readonly string[],
): { value: string; label: string; disabled?: boolean }[] {
  return options.map((o) => {
    const state = simState(o.sims, sim);
    return {
      value: o.value,
      label: state.badge ? `${o.label} (${state.badge})` : o.label,
      disabled: state.disabled && !keep.includes(o.value),
    };
  });
}

/**
 * The drag type for one picker. It carries the setting's key (lower-cased, as the browser does
 * to drag types), so a chip from another list, or a drag that is not a chip at all (a column
 * handle), is never accepted.
 */
export function pickDragType(fieldKey: string): string {
  return `application/x-ov-pick.${fieldKey.toLowerCase()}`;
}

/** The dragged chip's index from a drop's data, or null when it is not a valid index here. */
export function parsePickDrag(data: string, length: number): number | null {
  if (!/^\d+$/.test(data)) return null;
  const from = Number(data);
  return from < length ? from : null;
}

// No hooks here, so the tree can be inspected without a DOM: the drag source index travels in
// the drag event's data.
export function FieldPicker({ field, values, sim, disabled, onChange }: FieldPickerProps) {
  const dragType = pickDragType(field.key);
  const full = field.max !== undefined && values.length >= field.max;
  const labelOf = (v: string): string => field.options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="ov-multi">
      <p className="ov-multi-count" aria-live="polite">
        {pickCounter(values.length, field.max)}
      </p>
      <ul className="ov-chips" aria-label={`${field.label} order`}>
        {values.map((v, i) => {
          const label = labelOf(v);
          return (
            <li
              key={v}
              className="ov-chip"
              draggable={!disabled}
              onDragStart={(e) => e.dataTransfer.setData(dragType, String(i))}
              onDragOver={(e) => {
                if (!disabled && e.dataTransfer.types.includes(dragType)) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = parsePickDrag(e.dataTransfer.getData(dragType), values.length);
                if (!disabled && from !== null) {
                  onChange(reorderPick(values, from, i, field.max));
                }
              }}
            >
              <span>{label}</span>
              <button
                type="button"
                aria-label={`Move left ${label}`}
                disabled={disabled || i === 0}
                onClick={() => onChange(movePick(values, i, -1, field.max))}
              >
                ◀
              </button>
              <button
                type="button"
                aria-label={`Move right ${label}`}
                disabled={disabled || i === values.length - 1}
                onClick={() => onChange(movePick(values, i, 1, field.max))}
              >
                ▶
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ov-pick-grid" role="group" aria-label={`${field.label} choices`}>
        {field.options.map((o) => {
          const picked = values.includes(o.value);
          const state = simState(o.sims, sim);
          // A pick can always be removed, even one the current sim cannot show.
          const off = picked ? false : disabled || full || state.disabled;
          return (
            <label key={o.value} className="ov-pick" data-off={off || undefined}>
              <input
                type="checkbox"
                aria-label={o.label}
                checked={picked}
                disabled={off}
                onChange={() =>
                  onChange(
                    picked ? removePick(values, o.value) : addPick(values, o.value, field.max),
                  )
                }
              />
              <span>{o.label}</span>
              {state.badge && <em className="ctl-badge">{state.badge}</em>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
