import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import type { OverlaySize } from "../../../shared/types";
import type { DisplayPrefs } from "@overlay/ui/types";
import { Toggle } from "../controls";
import { OverlayPreview, type PreviewMeasure } from "../preview/OverlayPreview";
import { useState } from "react";
import "./overlays.css";
import { OverlayPanel, type SendPatch } from "./OverlayPanel";
import {
  canAddInstance,
  listOverlays,
  settingsOf,
  simState,
  type OverlayEntry,
  type SimContext,
} from "./model";

export interface OverlaysFormProps {
  manifests: readonly OverlayManifest[];
  /** Settings by instance id. */
  all: Readonly<Record<string, OverlayInstanceSettings>>;
  developerEnabled: boolean;
  selectedId: string | null;
  sim: SimContext;
  /** Real on-screen overlay sizes, by overlay id; empty until known. */
  sizes: Readonly<Record<string, OverlaySize>>;
  prefs: DisplayPrefs;
  onSelect(id: string): void;
  onToggle(id: string, enabled: boolean): void;
  send(id: string, patch: Parameters<SendPatch>[0], debounceKey?: string): void;
  onReset(id: string): void;
  /** Adds another instance of the overlay `id` is an instance of. */
  onAddInstance(id: string): void;
  /** Removes an added instance. */
  onRemoveInstance(id: string): void;
}

/** The first active overlay instance, else the first listed one. */
export function defaultSelection(
  manifests: readonly OverlayManifest[],
  all: OverlaysFormProps["all"],
  developerEnabled: boolean,
): string | null {
  const { active, available } = listOverlays(manifests, all, developerEnabled);
  return (active[0] ?? available[0])?.id ?? null;
}

export function OverlaysForm(props: OverlaysFormProps) {
  const { manifests, all, developerEnabled, sim, prefs } = props;
  const [measure, setMeasure] = useState<{ id: string; m: PreviewMeasure } | null>(null);
  const { active, available } = listOverlays(manifests, all, developerEnabled);
  const selected =
    [...active, ...available].find((m) => m.id === props.selectedId) ?? active[0] ?? available[0];
  const group = (title: string, list: OverlayEntry[]) => (
    <section className="ov-group" aria-label={title}>
      <h2>{title}</h2>
      {list.length === 0 && <p className="muted">None</p>}
      <ul className="ov-list">
        {list.map((e) => {
          const m = e.manifest;
          const state = simState(m.sims, sim);
          const enabled = settingsOf(m, all, e.id).enabled;
          return (
            <li
              key={e.id}
              className="ov-item"
              data-selected={e.id === selected?.id || undefined}
              data-instance={e.added || undefined}
              aria-disabled={state.disabled || undefined}
            >
              <button
                type="button"
                className="ov-item-main"
                aria-current={e.id === selected?.id ? "true" : undefined}
                onClick={() => props.onSelect(e.id)}
              >
                <span className="ov-item-title">
                  {e.title}
                  {state.badge && <em className="ctl-badge">{state.badge}</em>}
                </span>
                <small className="muted">
                  {e.added ? `Another ${m.title} window` : m.description}
                </small>
              </button>
              <Toggle
                label={`Enable ${e.title}`}
                checked={enabled}
                disabled={state.disabled && !enabled}
                onChange={(next) => props.onToggle(e.id, next)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
  return (
    <div className="ov-container">
      <div className="ov-page">
        <div className="ov-left">
          {group("Active overlays", active)}
          {group("Available overlays", available)}
        </div>
        <aside className="ov-preview" aria-label="Preview">
          {selected && (
            <OverlayPreview
              key={selected.id}
              manifest={selected.manifest}
              settings={settingsOf(selected.manifest, all, selected.id)}
              size={props.sizes[selected.id] ?? null}
              onMeasure={(next) =>
                setMeasure((prev) =>
                  prev &&
                  prev.id === selected.id &&
                  prev.m.tableWidthPx === next.tableWidthPx &&
                  prev.m.chPx === next.chPx
                    ? prev
                    : { id: selected.id, m: next },
                )
              }
            />
          )}
        </aside>
        <div className="ov-right">
          {selected ? (
            <OverlayPanel
              key={selected.id}
              manifest={selected.manifest}
              instanceId={selected.id}
              canAddInstance={canAddInstance(selected.manifest, all)}
              onAddInstance={() => props.onAddInstance(selected.id)}
              onRemoveInstance={() => props.onRemoveInstance(selected.id)}
              settings={settingsOf(selected.manifest, all, selected.id)}
              sim={sim}
              prefs={prefs}
              measure={measure?.id === selected.id ? measure.m : null}
              send={(patch, key) => props.send(selected.id, patch, key)}
              onReset={() => props.onReset(selected.id)}
            />
          ) : (
            <p className="muted">No overlays.</p>
          )}
        </div>
      </div>
    </div>
  );
}
