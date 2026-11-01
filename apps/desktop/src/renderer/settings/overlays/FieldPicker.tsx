import type { SettingField } from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import { Select } from "../controls";
import { addPick, movePick, removePick, simState } from "./model";

type MultiField = Extract<SettingField, { kind: "multi" }>;

/**
 * The picker for every `kind: "multi"` setting (header and footer fields).
 * Owned by MW-5; OverlayPanel mounts it with exactly these props.
 */
export interface FieldPickerProps {
  field: MultiField;
  values: readonly string[];
  sim: SimName;
  disabled: boolean;
  onChange(next: readonly string[]): void;
}

/** Options for a Select; sim-limited ones are disabled unless they are already picked. */
export function optionList(
  options: readonly { value: string; label: string; sims?: readonly SimName[] }[],
  sim: SimName,
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

export function FieldPicker({ field, values, sim, disabled, onChange }: FieldPickerProps) {
  const full = field.max !== undefined && values.length >= field.max;
  const remaining = optionList(
    field.options.filter((o) => !values.includes(o.value)),
    sim,
    [],
  );
  return (
    <div className="ov-multi">
      <ul className="ov-chips">
        {values.map((v, i) => {
          const label = field.options.find((o) => o.value === v)?.label ?? v;
          return (
            <li key={v} className="ov-chip">
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
              <button
                type="button"
                aria-label={`Remove ${label}`}
                disabled={disabled}
                onClick={() => onChange(removePick(values, v))}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <Select
        label={`Add ${field.label}`}
        value=""
        disabled={disabled || full || remaining.length === 0}
        options={[{ value: "", label: "Add…", disabled: true }, ...remaining]}
        onChange={(next) => {
          if (next !== "") onChange(addPick(values, next, field.max));
        }}
      />
    </div>
  );
}
