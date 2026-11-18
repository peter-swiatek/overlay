import { useEffect, useState } from "react";
import type { AppSettings, AppSettingsPatch } from "../../../shared/app-settings-types";
import { Row, Section, Segmented, Toggle } from "../controls";
import { useAppSettings } from "../controls/useAppSettings";

const SCALES = [100, 110, 125, 150] as const;

/** "Start with Windows" only does something in an installed Windows build. */
export function startWithWindowsAvailable(isPackaged: boolean, platform: string): boolean {
  return isPackaged && /win/i.test(platform);
}

export function GeneralPage() {
  const { settings, update } = useAppSettings();
  const [isPackaged, setIsPackaged] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.overlayApi.getAppInfo().then((i) => alive && setIsPackaged(i.isPackaged));
    return () => {
      alive = false;
    };
  }, []);

  if (!settings) return <p className="muted">Loading...</p>;
  return (
    <GeneralForm
      settings={settings}
      update={update}
      canAutostart={startWithWindowsAvailable(isPackaged, navigator.platform)}
    />
  );
}

/** The form itself, separate from the IPC hooks so it renders with fake settings. */
export function GeneralForm({
  settings,
  update,
  canAutostart,
}: {
  settings: AppSettings;
  update(patch: AppSettingsPatch): void;
  canAutostart: boolean;
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
          label="Start hidden when Windows starts"
          help="Start in the tray without opening this window. Starting the app by hand always opens it."
          disabled={!canAutostart || !g.startWithWindows}
        >
          <Toggle
            label="Start hidden when Windows starts"
            checked={g.startHiddenAtLogin}
            disabled={!canAutostart || !g.startWithWindows}
            onChange={(startHiddenAtLogin) => set({ startHiddenAtLogin })}
          />
        </Row>
        <Row
          label="When I close the window"
          help="Overlays only keep running in the tray. Quit stops them too."
        >
          <Segmented
            label="When I close the window"
            value={g.closeAction}
            options={[
              { value: "tray", label: "Keep running in the tray" },
              { value: "quit", label: "Quit" },
            ]}
            onChange={(closeAction) => set({ closeAction })}
          />
        </Row>
        <Row
          label="Minimise when a game connects"
          help="Keeps this window out of the way once a sim starts sending data."
        >
          <Toggle
            label="Minimise when a game connects"
            checked={g.minimiseOnConnect}
            onChange={(minimiseOnConnect) => set({ minimiseOnConnect })}
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
