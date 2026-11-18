import {
  COMMON_LIMITS,
  type CommonOverlaySettings,
  type OverlayInstanceSettings,
  type OverlayManifest,
  type OverlaySettingsPatch,
  type SettingField,
  type SettingValue,
} from "@overlay/overlays/contract";
import { instanceTitle, isAddedInstance, MAX_INSTANCE_NAME } from "@overlay/overlays/instances";
import { isEmptyOrTwitchChannel, storedTwitchChannel } from "@overlay/overlays/twitch-chat";
import { isEmptyOrWebPageUrl } from "@overlay/overlays/web-url";
import type { DisplayPrefs } from "@overlay/ui/types";
import { useState, type ReactNode } from "react";
import type { PreviewMeasure } from "../preview/OverlayPreview";
import { ColumnEditor } from "./ColumnEditor";
import { customWidthPatch, type WidthMode } from "./columns-model";
import { FieldPicker, optionList } from "./FieldPicker";
import {
  Button,
  ColourInput,
  NumberStepper,
  Row,
  Segmented,
  Select,
  Slider,
  Toggle,
} from "../controls";
import "./overlays.css";
import {
  FALLBACK_COLOUR,
  HEADER_FOOTER_SECTION,
  fromDisplay,
  isSegmentedSelect,
  multiFields,
  panelSections,
  simState,
  toDisplay,
  type SimContext,
} from "./model";
import { displayDecimals, displayFactor, displayUnitLabel, roundTo } from "./units";

/** Sends a patch; with a key the send is debounced (sliders). */
export type SendPatch = (patch: OverlaySettingsPatch, debounceKey?: string) => void;

export interface OverlayPanelProps {
  manifest: OverlayManifest;
  settings: OverlayInstanceSettings;
  sim: SimContext;
  prefs: DisplayPrefs;
  send: SendPatch;
  onReset(): void;
  /** Which instance of the overlay the panel edits; instance 1 by default. */
  instanceId?: string;
  /** False when the overlay already has the most instances. */
  canAddInstance?: boolean;
  /** Absent: no instance controls (hosts that cannot add instances). */
  onAddInstance?(): void;
  onRemoveInstance?(): void;
  /** Latest preview measurement, for the column width floors. Null before the first one. */
  measure?: PreviewMeasure | null;
}

function widthModeOf(value: SettingValue | undefined): WidthMode | undefined {
  return value === "custom" || value === "auto" || value === "compact" ? value : undefined;
}

type Field<K extends SettingField["kind"]> = Extract<SettingField, { kind: K }>;

/** Typed text is sent after a pause, like a slider; everything else at once. */
function debounceKeyOf(field: SettingField): string | undefined {
  return field.kind === "text" ? `option:${field.key}` : undefined;
}

/** What a text field stores for `draft` (addresses are trimmed, channels become their login). */
export function storedText(field: Field<"text">, draft: string): string {
  if (field.format === "twitch-channel") return storedTwitchChannel(draft) ?? draft.trim();
  return field.format === "url" ? draft.trim() : draft;
}

/** Why `draft` cannot be stored, or null when it can. */
export function textError(field: Field<"text">, draft: string): string | null {
  if (draft.length > field.maxLength) return `At most ${field.maxLength} characters.`;
  if (field.format === "url" && !isEmptyOrWebPageUrl(draft)) {
    return "Enter an address starting with http:// or https://";
  }
  if (field.format === "twitch-channel" && !isEmptyOrTwitchChannel(draft)) {
    return "Enter a Twitch channel name (3 to 25 letters, digits or _) or its twitch.tv address";
  }
  return null;
}

export function OverlayPanel({
  manifest,
  settings,
  sim,
  prefs,
  send,
  onReset,
  measure,
  instanceId = manifest.id,
  canAddInstance = true,
  onAddInstance,
  onRemoveInstance,
}: OverlayPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Typed text as is: the stored name is trimmed, which would eat a space while typing.
  const [nameDraft, setNameDraft] = useState(settings.name ?? "");
  const common = settings.common;
  const setCommon = (patch: Partial<CommonOverlaySettings>, key?: string): void =>
    send({ common: patch }, key);
  const L = COMMON_LIMITS;
  const defaultTitle = instanceTitle(manifest, instanceId);
  const title = instanceTitle(manifest, instanceId, settings.name);
  const added = isAddedInstance(instanceId);
  return (
    <div className="ov-panel">
      <h3 className="ov-panel-title">{title}</h3>
      {onAddInstance && (
        <Collapsible title="Instances">
          <Row
            label="Name"
            help={`Shown in this list and in the overlay's title bar. Empty uses "${defaultTitle}".`}
          >
            <input
              type="text"
              className="ov-name-input"
              aria-label="Instance name"
              maxLength={MAX_INSTANCE_NAME}
              placeholder={defaultTitle}
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
                send({ name: e.target.value }, "name");
              }}
            />
          </Row>
          <Row
            label="Another window"
            help={`Adds another ${manifest.title} with a copy of these settings. Each one has its own settings, position and size.`}
          >
            <Button disabled={!canAddInstance} onClick={onAddInstance}>
              Add instance
            </Button>
          </Row>
          {added && onRemoveInstance && (
            <div className="ov-reset">
              {confirmingRemove ? (
                <>
                  <span>{`Remove ${title}? Its settings, position and size are deleted.`}</span>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setConfirmingRemove(false);
                      onRemoveInstance();
                    }}
                  >
                    Remove
                  </Button>
                  <Button onClick={() => setConfirmingRemove(false)}>Cancel</Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirmingRemove(true)}>
                  Remove instance
                </Button>
              )}
            </div>
          )}
        </Collapsible>
      )}
      <Collapsible title="Appearance">
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
          help="Unlock in the top bar, then drag the bottom-right corner of an overlay to resize it."
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
      </Collapsible>
      <Collapsible title="Visibility">
        <Row
          label="Show title bar"
          help="Show the overlay's name above it while driving. It always shows while overlays are unlocked."
        >
          <Toggle
            label="Show title bar"
            checked={common.showTitleBar}
            onChange={(showTitleBar) => setCommon({ showTitleBar })}
          />
        </Row>
        <Row label="In garage" help="Hide this overlay while you are in the garage.">
          <Toggle
            label="Hide in garage"
            checked={common.hideInGarage}
            onChange={(hideInGarage) => setCommon({ hideInGarage })}
          />
        </Row>
        <Row label="On track" help="Hide this overlay while you are driving.">
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
      </Collapsible>
      {manifest.fields.length > 0 && (
        <ColumnEditor
          manifest={manifest}
          fields={common.fields}
          sim={sim}
          onFields={(fields) => setCommon({ fields })}
          onWidth={(fields) => setCommon({ fields }, "fields-width")}
          onWidthCustom={(fields) => send(customWidthPatch(fields), "fields-width")}
          widthMode={widthModeOf(settings.options["column-width"])}
          widthScalePct={
            typeof settings.options["width-fine-tune"] === "number"
              ? settings.options["width-fine-tune"]
              : undefined
          }
          tableWidthPx={measure && measure.tableWidthPx > 0 ? measure.tableWidthPx : undefined}
          chPx={measure && measure.chPx > 0 ? measure.chPx : undefined}
          cellPadPx={measure?.cellPadPx}
          hiddenByWidth={measure?.hiddenColumnIds}
        />
      )}
      {multiFields(manifest).length > 0 && (
        <Collapsible title={HEADER_FOOTER_SECTION}>
          {multiFields(manifest).map((field) => (
            <SettingRow
              key={field.key}
              field={field}
              value={settings.options[field.key] ?? field.default}
              sim={sim}
              prefs={prefs}
              onChange={(value) => send({ options: { [field.key]: value } }, debounceKeyOf(field))}
            />
          ))}
        </Collapsible>
      )}
      {panelSections(manifest).map((section) => (
        <Collapsible key={section.title} title={section.title}>
          {section.fields.map((field) => (
            <SettingRow
              key={field.key}
              field={field}
              value={settings.options[field.key] ?? field.default}
              sim={sim}
              prefs={prefs}
              onChange={(value) => send({ options: { [field.key]: value } }, debounceKeyOf(field))}
            />
          ))}
        </Collapsible>
      ))}
      <div className="ov-reset">
        {confirming ? (
          <>
            <span>{`Reset ${title} to its defaults? Position and size are kept.`}</span>
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

/** A panel section that can be folded away; open by default. */
function Collapsible({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <details className="ctl-section ovs-section" open>
      <summary className="ovs-section-head">
        <h2>{title}</h2>
      </summary>
      <div className="ctl-rows">{children}</div>
    </details>
  );
}

export function SettingRow({
  field,
  value,
  sim,
  prefs,
  onChange,
}: {
  field: SettingField;
  value: SettingValue;
  sim: SimContext;
  prefs: DisplayPrefs;
  onChange(next: SettingValue): void;
}) {
  const state = simState(field.sims, sim);
  return (
    <Row label={field.label} help={field.help} disabled={state.disabled} badge={state.badge}>
      <SettingControl field={field} value={value} sim={sim} prefs={prefs} onChange={onChange} />
    </Row>
  );
}

export function SettingControl({
  field,
  value,
  sim,
  prefs,
  onChange,
}: {
  field: SettingField;
  value: SettingValue;
  sim: SimContext;
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
      if (isSegmentedSelect(field)) {
        return (
          <Segmented
            label={field.label}
            value={current}
            disabled={off}
            options={field.options.map((o) => ({ value: o.value, label: o.label }))}
            onChange={onChange}
          />
        );
      }
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
    case "text":
      return (
        <TextSetting
          field={field}
          value={typeof value === "string" ? value : field.default}
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

/**
 * A one-line input or a text area. Keeps what is typed and sends only values the field accepts;
 * a value changed elsewhere (reset) replaces the draft.
 */
function TextSetting({
  field,
  value,
  disabled,
  onChange,
}: {
  field: Field<"text">;
  value: string;
  disabled: boolean;
  onChange(next: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    if (value !== storedText(field, draft)) setDraft(value);
  }
  const error = textError(field, draft);
  const edit = (next: string): void => {
    setDraft(next);
    if (textError(field, next) === null) onChange(storedText(field, next));
  };
  const common = {
    "aria-label": field.label,
    "aria-invalid": error !== null || undefined,
    maxLength: field.maxLength,
    placeholder: field.placeholder,
    disabled,
    spellCheck: false,
    value: draft,
  };
  return (
    <span className="ov-text" data-multiline={field.multiline || undefined}>
      {field.multiline ? (
        <textarea
          {...common}
          className="ov-text-input"
          rows={4}
          onChange={(e) => edit(e.target.value)}
        />
      ) : (
        <input
          {...common}
          type={field.format === "url" ? "url" : "text"}
          className="ov-text-input"
          onChange={(e) => edit(e.target.value)}
        />
      )}
      {error && (
        <small className="ov-text-error" role="alert">
          {error}
        </small>
      )}
    </span>
  );
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
