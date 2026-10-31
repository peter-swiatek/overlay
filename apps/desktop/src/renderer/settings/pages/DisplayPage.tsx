import { useEffect, useState } from "react";
import type { AppInfo, DisplaySettings } from "../../../shared/types";
import { Button, Row, Section, Toggle } from "../controls";

interface DisplayOption {
  key: keyof DisplaySettings;
  label: string;
  help: string;
}

export const DISPLAY_OPTIONS: readonly DisplayOption[] = [
  {
    key: "disableHardwareAcceleration",
    label: "Disable hardware acceleration",
    help: "Try this if overlays show a black background or flicker.",
  },
  {
    key: "disableDirectComposition",
    label: "Disable DirectComposition",
    help: "Try this if overlays show a black background after a graphics driver update.",
  },
  {
    key: "opacityWorkaround",
    label: "Transparency fix (window opacity 0.99)",
    help: "Try this if overlays show a black background instead of being see-through.",
  },
  {
    key: "disableNativeOcclusion",
    label: "Disable native window occlusion",
    help: "Try this if overlays flicker or stop updating while another window covers them.",
  },
];

/** True when the stored settings differ from the ones this run started with. */
export function needsRestart(info: Pick<AppInfo, "display" | "effective" | "safeMode">): boolean {
  // Safe mode forces every fallback on for one run, so stored and effective always differ.
  if (info.safeMode) return false;
  return DISPLAY_OPTIONS.some(({ key }) => info.display[key] !== info.effective[key]);
}

export function DisplayView({
  info,
  onToggle,
  onRestart,
}: {
  info: AppInfo | undefined;
  onToggle(key: keyof DisplaySettings, value: boolean): void;
  onRestart(): void;
}) {
  return (
    <Section
      title="Display fallbacks"
      description="Try these if overlays render with a black background or flicker. Each one applies at the next start."
    >
      {info && needsRestart(info) && (
        <p className="note" role="status">
          Restart to apply your changes{" "}
          <Button variant="primary" onClick={onRestart}>
            Restart now
          </Button>
        </p>
      )}
      {DISPLAY_OPTIONS.map(({ key, label, help }) => (
        <Row key={key} label={label} help={help} badge="restart to apply" disabled={!info}>
          <Toggle
            checked={info?.display[key] ?? false}
            disabled={!info}
            onChange={(next) => onToggle(key, next)}
          />
        </Row>
      ))}
      {info?.safeMode && (
        <p className="note">
          Running with --safe-mode: all four fallbacks are active.{" "}
          <Button onClick={onRestart}>Restart normally</Button>
        </p>
      )}
      <p className="muted">
        Run the sim in borderless or windowed mode; exclusive fullscreen hides every overlay app.
      </p>
    </Section>
  );
}

export function DisplayPage() {
  const [info, setInfo] = useState<AppInfo>();

  useEffect(() => {
    void window.overlayApi.getAppInfo().then(setInfo);
  }, []);

  const toggle = (key: keyof DisplaySettings, value: boolean): void => {
    void window.overlayApi.setDisplaySettings({ [key]: value }).then((display) => {
      setInfo((prev) => (prev ? { ...prev, display } : prev));
    });
  };

  return (
    <DisplayView
      info={info}
      onToggle={toggle}
      onRestart={() => void window.overlayApi.restartApp()}
    />
  );
}
