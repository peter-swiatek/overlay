import {
  COMMON_LIMITS,
  type CommonOverlaySettings,
  type OverlayInstanceSettings,
  type OverlayManifest,
  type OverlaySettingsPatch,
  type SettingField,
  type SettingValue,
} from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import type { DisplayPrefs, FieldConfig } from "@overlay/ui/types";
import { useState } from "react";
import {
  Button,
  ColourInput,
  NumberStepper,
  Row,
  Section,
  Select,
  Slider,
  Toggle,
} from "../controls";
import "./overlays.css";
import {
  FALLBACK_COLOUR,
  addPick,
  fieldDef,
  fromDisplay,
  movePick,
  panelSections,
  removePick,
  setFieldPatch,
  moveField,
  shownWidthPct,
  simState,
  toDisplay,
} from "./model";
import { displayDecimals, displayFactor, displayUnitLabel, roundTo } from "./units";

/** Sends a patch; with a key the send is debounced (sliders). */
export type SendPatch = (patch: OverlaySettingsPatch, debounceKey?: string) => void;

export interface OverlayPanelProps {
  manifest: OverlayManifest;
  settings: OverlayInstanceSettings;
  sim: SimName;
  prefs: DisplayPrefs;
  send: SendPatch;
  onReset(): void;
}

type Field<K extends SettingField["kind"]> = Extract<SettingField, { kind: K }>;

export function OverlayPanel({ manifest, settings, sim, prefs, send, onReset }: OverlayPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const common = settings.common;
  const setCommon = (patch: Partial<CommonOverlaySettings>, key?: string): void =>
    send({ common: patch }, key);
  const L = COMMON_LIMITS;
  return (
    <div className="ov-panel">
      <h3 className="ov-panel-title">{manifest.title}</h3>
      <Section title="Appearance">
        <Row label="Opacity">
          <Slider
            label="Opacity"
            value={common.opacityPct}
            min={L.opacityPct.min}
            max={L.opacityPct.max}
            step={L.opacityPct.step}
            unit="%"
            onChange={(opacityPct) => setCommon({ opacityPct }, "opacityPct")}
          />
        </Row>
        <Row
          label="Scale"
          help="Unlock overlays (Ctrl+Shift+F10), then drag the bottom-right corner to resize."
        >
          <Slider
            label="Scale"
            value={common.scalePct}
            min={L.scalePct.min}
            max={L.scalePct.max}
            step={L.scalePct.step}
            unit="%"
            onChange={(scalePct) => setCommon({ scalePct }, "scalePct")}
          />
        </Row>
        {manifest.table && (
          <Row label="Row opacity">
            <Slider
              label="Row opacity"
              value={common.rowOpacityPct}
              min={L.rowOpacityPct.min}
              max={L.rowOpacityPct.max}
              step={L.rowOpacityPct.step}
              unit="%"
              onChange={(rowOpacityPct) => setCommon({ rowOpacityPct }, "rowOpacityPct")}
            />
          </Row>
        )}
      </Section>
      <Section title="Hidden">
        <Row label="In garage">
          <Toggle
            label="Hide in garage"
            checked={common.hideInGarage}
            onChange={(hideInGarage) => setCommon({ hideInGarage })}
          />
        </Row>
        <Row label="On track">
          <Toggle
            label="Hide on track"
            checked={common.hideOnTrack}
            onChange={(hideOnTrack) => setCommon({ hideOnTrack })}
          />
        </Row>
        <Row
          label="Always show"
          help="Keep visible when no sim is running, even with auto-hide on."
        >
          <Toggle
            label="Always show"
            checked={common.alwaysShow}
            onChange={(alwaysShow) => setCommon({ alwaysShow })}
          />
        </Row>
      </Section>
      {manifest.fields.length > 0 && (
        <FieldList
          manifest={manifest}
          fields={common.fields}
          sim={sim}
          onFields={(fields) => setCommon({ fields })}
          onWidth={(fields) => setCommon({ fields }, "fields-width")}
        />
      )}
      {panelSections(manifest).map((section) => (
        <Section key={section.title} title={section.title}>
          {section.fields.map((field) => (
            <SettingRow
              key={field.key}
              field={field}
              value={settings.options[field.key] ?? field.default}
              sim={sim}
              prefs={prefs}
              onChange={(value) => send({ options: { [field.key]: value } })}
            />
          ))}
        </Section>
      ))}
      <div className="ov-reset">
        {confirming ? (
          <>
            <span>{`Reset ${manifest.title} to its defaults? Position and size are kept.`}</span>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onReset();
              }}
            >
              Reset
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Reset to defaults
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldList({
  manifest,
  fields,
  sim,
  onFields,
  onWidth,
}: {
  manifest: OverlayManifest;
  fields: readonly FieldConfig[];
  sim: SimName;
  onFields(next: FieldConfig[]): void;
  /** Width slider changes: debounced by the caller. */
  onWidth(next: FieldConfig[]): void;
}) {
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
                disabled={state.disabled}
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
              disabled={state.disabled}
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

function SettingRow({
  field,
  value,
  sim,
  prefs,
  onChange,
}: {
  field: SettingField;
  value: SettingValue;
  sim: SimName;
  prefs: DisplayPrefs;
  onChange(next: SettingValue): void;
}) {
  const state = simState(field.sims, sim);
  const maxHelp =
    field.kind === "multi" && field.max !== undefined ? `Pick up to ${field.max}` : "";
  const help = [field.help, maxHelp].filter(Boolean).join(" ") || undefined;
  return (
    <Row label={field.label} help={help} disabled={state.disabled} badge={state.badge}>
      <SettingControl field={field} value={value} sim={sim} prefs={prefs} onChange={onChange} />
    </Row>
  );
}

function SettingControl({
  field,
  value,
  sim,
  prefs,
  onChange,
}: {
  field: SettingField;
  value: SettingValue;
  sim: SimName;
  prefs: DisplayPrefs;
  onChange(next: SettingValue): void;
}) {
  const off = simState(field.sims, sim).disabled;
  switch (field.kind) {
    case "toggle":
      return (
        <Toggle label={field.label} checked={value === true} disabled={off} onChange={onChange} />
      );
    case "number":
      return (
        <NumberSetting
          field={field}
          value={typeof value === "number" ? value : field.default}
          prefs={prefs}
          disabled={off}
          onChange={onChange}
        />
      );
    case "select": {
      const current = typeof value === "string" ? value : field.default;
      return (
        <Select
          label={field.label}
          value={current}
          disabled={off}
          options={optionList(field.options, sim, [current])}
          onChange={onChange}
        />
      );
    }
    case "multi":
      return (
        <MultiSetting
          field={field}
          values={Array.isArray(value) ? (value as readonly string[]) : field.default}
          sim={sim}
          disabled={off}
          onChange={onChange}
        />
      );
    case "colour": {
      const accent = value === "accent";
      return (
        <span className="ov-colour" data-accent={accent || undefined}>
          {accent && <span className="ov-accent-label">Theme accent</span>}
          <ColourInput
            label={field.label}
            value={typeof value === "string" && !accent ? value : FALLBACK_COLOUR}
            onChange={onChange}
            onReset={() => onChange("accent")}
            resetLabel="Use theme accent"
          />
        </span>
      );
    }
  }
}

/** Options for a Select; sim-limited ones are disabled unless they are already picked. */
function optionList(
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

function NumberSetting({
  field,
  value,
  prefs,
  disabled,
  onChange,
}: {
  field: Field<"number">;
  value: number;
  prefs: DisplayPrefs;
  disabled: boolean;
  onChange(next: number): void;
}) {
  const { unit, step } = field;
  const decimals = displayDecimals(unit, step, prefs);
  const shownStep =
    decimals === 0
      ? Math.max(1, roundTo(step * displayFactor(unit, prefs), 0))
      : Math.max(0.1, roundTo(step * displayFactor(unit, prefs), 1));
  return (
    <NumberStepper
      label={field.label}
      value={toDisplay(unit, value, prefs, step)}
      min={toDisplay(unit, field.min, prefs, step)}
      max={toDisplay(unit, field.max, prefs, step)}
      step={shownStep}
      unit={displayUnitLabel(unit, prefs)}
      disabled={disabled}
      onChange={(shown) => onChange(fromDisplay(unit, shown, prefs, field, value))}
    />
  );
}

function MultiSetting({
  field,
  values,
  sim,
  disabled,
  onChange,
}: {
  field: Field<"multi">;
  values: readonly string[];
  sim: SimName;
  disabled: boolean;
  onChange(next: readonly string[]): void;
}) {
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
