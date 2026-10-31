import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings, OverlaySettingsPatch } from "@overlay/overlays/contract";
import { applySettingsPatch } from "@overlay/overlays/settings";
import type { SimName } from "@overlay/sim-core/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayPrefsOf } from "../../../shared/app-settings-types";
import { useAppSettings } from "../controls/useAppSettings";
import { browserTimer, createDebouncer } from "../overlays/debounce";
import { simFromSource, settingsOf } from "../overlays/model";
import { OverlaysForm, defaultSelection } from "../overlays/OverlaysForm";

export function OverlaysPage() {
  const { settings: app } = useAppSettings();
  const [all, setAll] = useState<Record<string, OverlayInstanceSettings> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sim, setSim] = useState<SimName>("iracing");
  const pickedByHand = useRef(false);
  const debouncer = useMemo(() => createDebouncer(browserTimer), []);

  useEffect(() => {
    const api = window.overlayApi;
    let alive = true;
    void api.overlays.getAll().then((s) => {
      if (alive) setAll(s);
    });
    const offChanged = api.overlays.onChanged((id, s) => {
      setAll((prev) => (prev ? { ...prev, [id]: s } : prev));
    });
    void api.telemetry.getStatus().then((ev) => {
      if (alive && ev && !pickedByHand.current) setSim(simFromSource(ev.source));
    });
    const offStatus = api.telemetry.onStatus((ev) => {
      if (!pickedByHand.current) setSim(simFromSource(ev.source));
    });
    return () => {
      alive = false;
      offChanged();
      offStatus();
      debouncer.flush();
    };
  }, [debouncer]);

  const send = useCallback(
    (id: string, patch: OverlaySettingsPatch, debounceKey?: string): void => {
      const manifest = OVERLAY_MANIFESTS.find((m) => m.id === id);
      if (!manifest) return;
      // The same code main runs, so the optimistic state matches the confirmed one.
      setAll((prev) =>
        prev
          ? { ...prev, [id]: applySettingsPatch(manifest, settingsOf(manifest, prev), patch) }
          : prev,
      );
      const run = (): void => void window.overlayApi.overlays.update(id, patch);
      if (debounceKey === undefined) run();
      else debouncer.schedule(`${id}:${debounceKey}`, run);
    },
    [debouncer],
  );

  if (!all || !app) return <p className="muted">Loading...</p>;
  const developerEnabled = app.developer.enabled;
  return (
    <OverlaysForm
      manifests={OVERLAY_MANIFESTS}
      all={all}
      developerEnabled={developerEnabled}
      selectedId={selectedId ?? defaultSelection(OVERLAY_MANIFESTS, all, developerEnabled)}
      sim={sim}
      prefs={displayPrefsOf(app)}
      onSelect={(id) => {
        debouncer.flush();
        setSelectedId(id);
      }}
      onToggle={(id, enabled) => send(id, { enabled })}
      onSim={(next) => {
        pickedByHand.current = true;
        setSim(next);
      }}
      send={send}
      onReset={(id) => {
        debouncer.flush();
        void window.overlayApi.overlays.reset(id);
      }}
    />
  );
}
