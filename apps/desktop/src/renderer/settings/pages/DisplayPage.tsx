import { useEffect, useState } from "react";
import type { AppInfo, DisplaySettings } from "../../../shared/types";

const OPTIONS: { key: keyof DisplaySettings; label: string }[] = [
  { key: "disableHardwareAcceleration", label: "Disable hardware acceleration" },
  { key: "disableDirectComposition", label: "Disable DirectComposition" },
  { key: "opacityWorkaround", label: "Opacity workaround (0.99)" },
];

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
    <section>
      <h2>Display fallbacks</h2>
      <p className="muted">Try these if overlays render with a black background.</p>
      {OPTIONS.map(({ key, label }) => (
        <label key={key} className="option">
          <input
            type="checkbox"
            checked={info?.display[key] ?? false}
            disabled={!info}
            onChange={(e) => toggle(key, e.target.checked)}
          />
          <span>{label}</span>
          <em>restart to apply</em>
        </label>
      ))}
      {info?.safeMode && (
        <p className="note">Running with --safe-mode: all three fallbacks are active.</p>
      )}
    </section>
  );
}
