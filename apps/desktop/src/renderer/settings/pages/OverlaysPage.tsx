import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings, OverlaySettingsPatch } from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayPrefsOf } from "../../../shared/app-settings-types";
import { useAppSettings } from "../controls/useAppSettings";
import { browserTimer, createDebouncer } from "../overlays/debounce";
import { simFromSource } from "../overlays/model";
import { OverlaysForm, defaultSelection } from "../overlays/OverlaysForm";
import { createOverlaySender } from "../overlays/sender";

export function OverlaysPage() {
  const { settings: app } = useAppSettings();
  const [all, setAll] = useState<Record<string, OverlayInstanceSettings> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sim, setSim] = useState<SimName>("iracing");
  const pickedByHand = useRef(false);
  const debouncer = useMemo(() => createDebouncer(browserTimer), []);
  const sender = useMemo(
    () =>
      createOverlaySender({
        manifests: OVERLAY_MANIFESTS,
        debouncer,
        update: (id, patch) => window.overlayApi.overlays.update(id, patch),
        publish: (next) => setAll(next),
      }),
    [debouncer],
  );

  useEffect(() => {
    const api = window.overlayApi;
    let alive = true;
    void api.overlays.getAll().then((s) => {
      if (alive) sender.load(s);
    });
    const offChanged = api.overlays.onChanged((id, s) => {
      sender.incoming(id, s);
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
  }, [debouncer, sender]);

  const send = useCallback(
    (id: string, patch: OverlaySettingsPatch, debounceKey?: string): void =>
      sender.send(id, patch, debounceKey),
    [sender],
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
