import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings, OverlaySettingsPatch } from "@overlay/overlays/contract";
import type { OverlaySize } from "../../../shared/types";
import type { TelemetryEvent, TelemetrySourceChoice } from "../../../shared/telemetry-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { displayPrefsOf } from "../../../shared/app-settings-types";
import { useAppSettings } from "../controls/useAppSettings";
import { browserTimer, createDebouncer } from "../overlays/debounce";
import { simForGame } from "../overlays/model";
import { OverlaysForm, defaultSelection } from "../overlays/OverlaysForm";
import { createOverlaySender } from "../overlays/sender";

export function OverlaysPage() {
  const { settings: app } = useAppSettings();
  const [all, setAll] = useState<Record<string, OverlayInstanceSettings> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, OverlaySize>>({});
  const [choice, setChoice] = useState<TelemetrySourceChoice>("auto");
  const [status, setStatus] = useState<TelemetryEvent | null>(null);
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
    void api.overlays.getSizes().then((s) => {
      if (alive) setSizes(s);
    });
    const offSizes = api.overlays.onSizesChanged(setSizes);
    void api.telemetry.getSource().then((view) => {
      if (alive) setChoice(view.source);
    });
    const offSource = api.telemetry.onSourceChanged((view) => setChoice(view.source));
    void api.telemetry.getStatus().then((ev) => {
      if (alive) setStatus(ev);
    });
    const offStatus = api.telemetry.onStatus(setStatus);
    return () => {
      alive = false;
      offChanged();
      offSizes();
      offSource();
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
      sim={simForGame(choice, status)}
      sizes={sizes}
      prefs={displayPrefsOf(app)}
      onSelect={(id) => {
        debouncer.flush();
        setSelectedId(id);
      }}
      onToggle={(id, enabled) => send(id, { enabled })}
      send={send}
      onReset={(id) => {
        debouncer.flush();
        void window.overlayApi.overlays.reset(id);
      }}
    />
  );
}
