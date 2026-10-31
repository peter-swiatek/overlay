import type { AppSettings } from "../../../shared/app-settings-types";
import { Row, Section, Segmented, Toggle } from "../controls";
import { useAppSettings } from "../controls/useAppSettings";

type Patch = (patch: Partial<AppSettings["performance"]>) => void;

/** The form itself, separate from the IPC hook so it renders with fake settings. */
export function PerformanceForm({ settings, set }: { settings: AppSettings; set: Patch }) {
  const p = settings.performance;
  return (
    <Section title="Telemetry and effects">
      <Row
        label="Telemetry update rate"
        help="30 Hz roughly halves overlay CPU; the Spotter and Pit Speed stay responsive."
      >
        <Segmented
          label="Telemetry update rate"
          value={String(p.telemetryRateHz) as "30" | "60"}
          options={[
            { value: "60", label: "60 Hz" },
            { value: "30", label: "30 Hz" },
          ]}
          onChange={(next) => set({ telemetryRateHz: next === "30" ? 30 : 60 })}
        />
      </Row>
      <Row
        label="Live position tracking"
        help="On: positions update continuously from track distance. Off: official positions, updated at the timing line."
      >
        <Toggle
          label="Live position tracking"
          checked={p.livePositions}
          onChange={(livePositions) => set({ livePositions })}
        />
      </Row>
      <Row label="Reduce visual effects" help="No fades or animations.">
        <Toggle
          label="Reduce visual effects"
          checked={p.reduceVisualEffects}
          onChange={(reduceVisualEffects) => set({ reduceVisualEffects })}
        />
      </Row>
    </Section>
  );
}

export function PerformancePage() {
  const { settings, update } = useAppSettings();
  if (!settings) return <p className="muted">Loading...</p>;
  return <PerformanceForm settings={settings} set={(performance) => update({ performance })} />;
}
