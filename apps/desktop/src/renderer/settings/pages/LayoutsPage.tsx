import { useEffect, useMemo, useState } from "react";
import type { LayoutsState } from "../../../shared/layout-types";
import { LayoutsView, type LayoutActions } from "../layouts/LayoutsView";

export function LayoutsPage() {
  const [state, setState] = useState<LayoutsState | null>(null);

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
    };
  }, []);

  if (!state) return <p className="muted">Loading...</p>;
  return <LayoutsView state={state} actions={actions} />;
}
