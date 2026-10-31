import { GRAPHITE, THEME_FONTS, THEME_WEIGHTS, themeToCssVars } from "@overlay/theme";
import type { Theme, ThemeFont, ThemeState, ThemeWeight } from "@overlay/theme/types";
import { IRatingPill, LicencePill } from "@overlay/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { LockedColours } from "../appearance/LockedColours";
import { ThemeEditorEntry } from "../appearance/editor";
import { ThemeGallery } from "../appearance/ThemeGallery";
import { ThemeScope } from "../appearance/ThemeScope";
import {
  activeTheme,
  applyActiveChanged,
  createThemeWriter,
  isPreset,
  type ThemeEdit,
} from "../appearance/model";
import { Row, Section, Segmented, Toggle } from "../controls";
import { useAppSettings } from "../controls/useAppSettings";

const FONT_LABELS: Record<ThemeFont, string> = {
  inter: "Inter",
  manrope: "Manrope",
  oswald: "Oswald",
  "barlow-condensed": "Barlow Condensed",
};
const WEIGHT_LABELS: Record<ThemeWeight, string> = {
  400: "Regular 400",
  500: "Medium 500",
  600: "SemiBold 600",
  700: "Bold 700",
  800: "ExtraBold 800",
};

type WeightKey = `${ThemeWeight}`;

/** The same family string the overlays use, so a label shows the face it names. */
function fontFamily(font: ThemeFont): string {
  return themeToCssVars({ ...GRAPHITE, font })["--ov-font-family"]!;
}

export interface AppearanceFormProps {
  state: ThemeState;
  combinePills: boolean;
  error: string | null;
  onSelect(id: string): void;
  onEdit(edit: ThemeEdit): void;
  onCombinePills(next: boolean): void;
  onState(next: ThemeState): void;
}

/** The page itself, separate from the IPC wiring so it renders with fake data. */
export function AppearanceForm(props: AppearanceFormProps) {
  const { state, combinePills, error } = props;
  const theme: Theme = activeTheme(state);
  const preset = isPreset(state, theme.id);
  return (
    <>
      <Section title="Theme">
        <ThemeGallery state={state} onSelect={props.onSelect} />
        <ThemeEditorEntry state={state} onState={props.onState} />
      </Section>
      <Section title="Typography">
        <Row label="Overlay font">
          <div role="group" aria-label="Overlay font" className="ctl-segmented">
            {THEME_FONTS.map((font) => (
              <button
                key={font}
                type="button"
                aria-pressed={theme.font === font}
                style={{ fontFamily: fontFamily(font) }}
                onClick={() => props.onEdit({ font })}
              >
                {FONT_LABELS[font]}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label="Weight"
          help={theme.font === "oswald" ? "Oswald has no ExtraBold; 800 shows as Bold." : undefined}
        >
          <Segmented<WeightKey>
            label="Weight"
            value={String(theme.weight) as WeightKey}
            options={THEME_WEIGHTS.map((w) => ({
              value: String(w) as WeightKey,
              label: WEIGHT_LABELS[w],
            }))}
            onChange={(next) => props.onEdit({ weight: Number(next) as ThemeWeight })}
          />
        </Row>
        <Row label="Compact mode" help="Smaller text and rows in every overlay.">
          <Toggle
            label="Compact mode"
            checked={theme.compact}
            onChange={(compact) => props.onEdit({ compact })}
          />
        </Row>
        {preset && <p className="note">Presets never change; your edits make a custom copy.</p>}
        {error && <p className="note ap-error">{error}</p>}
      </Section>
      <Section title="Pills">
        <Row label="Combine safety & iRating" help="Tint the iRating pill with the licence colour.">
          <Toggle
            label="Combine safety & iRating"
            checked={combinePills}
            onChange={props.onCombinePills}
          />
        </Row>
        <ThemeScope theme={theme} className="ap-pill-sample">
          <LicencePill licence="A 3.41" />
          <IRatingPill iRating={2412} licence="A 3.41" tinted={combinePills} />
        </ThemeScope>
      </Section>
      <LockedColours />
    </>
  );
}

export function AppearancePage() {
  const { settings, update } = useAppSettings();
  const [state, setState] = useState<ThemeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<ThemeState | null>(null);
  const writer = useMemo(() => createThemeWriter(window.overlayApi.theme), []);

  const accept = (next: ThemeState) => {
    latest.current = next;
    setState(next);
  };

  useEffect(() => {
    const api = window.overlayApi.theme;
    let alive = true;
    void api.getState().then((s) => {
      if (alive) accept(s);
    });
    const off = api.onChanged((active) => {
      if (latest.current) accept(applyActiveChanged(latest.current, active));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!state || !settings) return <p className="muted">Loading...</p>;

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Could not save the theme");
  return (
    <AppearanceForm
      state={state}
      combinePills={settings.appearance.combinedLicencePill}
      error={error}
      onState={accept}
      onSelect={(id) => {
        setError(null);
        window.overlayApi.theme.setActive(id).then(accept, fail);
      }}
      onEdit={(edit) => {
        setError(null);
        writer.write(latest.current ?? state, edit).then(accept, fail);
      }}
      onCombinePills={(combinedLicencePill) => update({ appearance: { combinedLicencePill } })}
    />
  );
}
