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
import type { DisplayPrefs } from "@overlay/ui/types";
import { useState } from "react";
import { ColumnEditor } from "./ColumnEditor";
import { FieldPicker, optionList } from "./FieldPicker";
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
import { FALLBACK_COLOUR, fromDisplay, panelSections, simState, toDisplay } from "./model";
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
        <ColumnEditor
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
        <Toggle
          label={field.label}
          checked={value === true}
          disabled={off && value !== true}
          onChange={onChange}
        />
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
        <FieldPicker
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
