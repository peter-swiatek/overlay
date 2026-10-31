import { useEffect, useState } from "react";
import type { AppSettings, AppSettingsPatch } from "../../../shared/app-settings-types";
import type { TelemetrySourceChoice, TelemetrySourceView } from "../../../shared/telemetry-types";
import { Row, Section, Segmented, Select, Toggle } from "../controls";
import { useAppSettings } from "../controls/useAppSettings";

type SettableSource = Exclude<TelemetrySourceChoice, "replay">;
type SourceValue = TelemetrySourceChoice;

const BASE_SOURCES: { value: SourceValue; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "iracing", label: "iRacing" },
  { value: "lmu", label: "LMU" },
];

const SCALES = [100, 110, 125, 150] as const;

/**
 * Data source entries. A Replay or Mock source (set from the tray or the Developer page) is
 * shown as an extra selected entry so the control never lies about what is running.
 */
export function sourceOptions(
  current: TelemetrySourceChoice,
): { value: SourceValue; label: string }[] {
  if (current === "replay")
    return [...BASE_SOURCES, { value: "replay", label: "Replay (developer)" }];
  if (current === "mock") return [...BASE_SOURCES, { value: "mock", label: "Mock (developer)" }];
  return BASE_SOURCES;
}

/** "Start with Windows" only does something in an installed Windows build. */
export function startWithWindowsAvailable(isPackaged: boolean, platform: string): boolean {
  return isPackaged && /win/i.test(platform);
}

export function GeneralPage() {
  const { settings, update } = useAppSettings();
  const [source, setSource] = useState<TelemetrySourceView>();
  const [isPackaged, setIsPackaged] = useState(false);

  useEffect(() => {
    const api = window.overlayApi;
    let alive = true;
    void api.telemetry.getSource().then((v) => alive && setSource(v));
    void api.getAppInfo().then((i) => alive && setIsPackaged(i.isPackaged));
    const off = api.telemetry.onSourceChanged(setSource);
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!settings) return <p className="muted">Loading...</p>;
  return (
    <GeneralForm
      settings={settings}
      update={update}
      source={source}
      canAutostart={startWithWindowsAvailable(isPackaged, navigator.platform)}
      onSource={(choice) => void window.overlayApi.telemetry.setSource(choice).then(setSource)}
    />
  );
}

/** The form itself, separate from the IPC hooks so it renders with fake settings. */
export function GeneralForm({
  settings,
  update,
  source,
  canAutostart,
  onSource,
}: {
  settings: AppSettings;
  update(patch: AppSettingsPatch): void;
  source: TelemetrySourceView | undefined;
  canAutostart: boolean;
  onSource(choice: SettableSource): void;
}) {
  const g = settings.general;
  const set = (patch: AppSettingsPatch["general"]): void => update({ general: patch });

  return (
    <>
      <Section title="Units and time">
        <Row label="Units">
          <Segmented
            label="Units"
            value={g.units}
            options={[
              { value: "metric", label: "Metric" },
              { value: "imperial", label: "Imperial" },
            ]}
            onChange={(units) => set({ units })}
          />
        </Row>
        <Row
          label="Keep car speed in mph"
          help="Show speeds in mph while everything else stays metric."
          disabled={g.units !== "metric"}
        >
          <Toggle
            label="Keep car speed in mph"
            checked={g.speedInMph}
            disabled={g.units !== "metric"}
            onChange={(speedInMph) => set({ speedInMph })}
          />
        </Row>
        <Row label="Time format">
          <Segmented
            label="Time format"
            value={g.timeFormat}
            options={[
              { value: "24h", label: "24 h" },
              { value: "12h", label: "12 h" },
            ]}
            onChange={(timeFormat) => set({ timeFormat })}
          />
        </Row>
      </Section>
      <Section title="Data">
        <Row label="Data source">
          <Select
            label="Data source"
            value={source?.source ?? "auto"}
            disabled={!source}
            options={sourceOptions(source?.source ?? "auto")}
            onChange={(next) => {
              if (next === "replay" || next === "mock") return;
              onSource(next);
            }}
          />
        </Row>
      </Section>
      <Section title="Startup">
        <Row
          label="Start with Windows"
          help={canAutostart ? undefined : "Only available in the installed Windows app."}
          disabled={!canAutostart}
        >
          <Toggle
            label="Start with Windows"
            checked={g.startWithWindows}
            disabled={!canAutostart}
            onChange={(startWithWindows) => set({ startWithWindows })}
          />
        </Row>
        <Row
          label="Hide overlays when no sim is running"
          help={'An overlay\'s own "Always show" overrides this.'}
        >
          <Toggle
            label="Hide overlays when no sim is running"
            checked={g.autoHide}
            onChange={(autoHide) => set({ autoHide })}
          />
        </Row>
      </Section>
      <Section title="Interface">
        <Row label="UI scale" help="Scales this settings window only.">
          <Segmented
            label="UI scale"
            value={String(g.uiScalePct)}
            options={SCALES.map((s) => ({ value: String(s), label: `${s} %` }))}
            onChange={(next) => {
              const uiScalePct = SCALES.find((s) => String(s) === next);
              if (uiScalePct) set({ uiScalePct });
            }}
          />
        </Row>
        <Row
          label="Developer tools"
          help="Shows the Developer page, test data sources (Replay file, Mock) and developer overlays."
        >
          <Toggle
            label="Developer tools"
            checked={settings.developer.enabled}
            onChange={(enabled) => update({ developer: { enabled } })}
          />
        </Row>
      </Section>
    </>
  );
}
