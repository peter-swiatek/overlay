import { useEffect, useMemo, useState } from "react";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import type { LayoutsState } from "../../../shared/layout-types";
import { useAppSettings } from "../controls/useAppSettings";
import { LayoutsView, type LayoutActions } from "../layouts/LayoutsView";
import { groupOverlays } from "../layouts/model";

/** Follows every overlay instance's settings (for the titles and the list of copies). */
function useOverlayInstances(): Record<string, OverlayInstanceSettings> | null {
  const [all, setAll] = useState<Record<string, OverlayInstanceSettings> | null>(null);
  useEffect(() => {
    const api = window.overlayApi.overlays;
    let alive = true;
    void api.getAll().then((s) => {
      if (alive) setAll(s);
    });
    const offChange = api.onChanged((id, settings) =>
      setAll((prev) => (prev ? { ...prev, [id]: settings } : prev)),
    );
    const offRemove = api.onRemoved((id) =>
      setAll((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }),
    );
    return () => {
      alive = false;
      offChange();
      offRemove();
    };
  }, []);
  return all;
}

export function LayoutsPage() {
  const [state, setState] = useState<LayoutsState | null>(null);
  const instances = useOverlayInstances();
  const { settings: app } = useAppSettings();
  const developer = app?.developer.enabled ?? false;

  useEffect(() => {
    const api = window.overlayApi.layouts;
    let alive = true;
    void api.get().then((s) => {
      if (alive) setState(s);
    });
    const off = api.onChanged(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const actions = useMemo((): LayoutActions => {
    const api = window.overlayApi.layouts;
    const apply = (pending: Promise<LayoutsState>): void => {
      void pending.then(setState);
    };
    return {
      activate: (id) => apply(api.activate(id)),
      create: () => apply(api.create()),
      duplicate: (id) => apply(api.duplicate(id)),
      rename: (id, name) => apply(api.rename(id, name)),
      remove: (id) => apply(api.remove(id)),
      setMatch: (id, patch) => apply(api.setMatch(id, patch)),
      setAutoSwitch: (on) => apply(api.setAutoSwitch(on)),
      setEnabled: (id, instanceId, on) => apply(api.setEnabled(id, instanceId, on)),
    };
  }, []);

  const overlays = useMemo(
    () => (instances ? groupOverlays(OVERLAY_MANIFESTS, instances, developer) : []),
    [instances, developer],
  );

  if (!state || !instances) return <p className="muted">Loading...</p>;
  return <LayoutsView state={state} overlays={overlays} actions={actions} />;
}
