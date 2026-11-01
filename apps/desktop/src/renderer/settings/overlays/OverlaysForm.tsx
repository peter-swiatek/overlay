import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import type { OverlaySize } from "../../../shared/types";
import type { DisplayPrefs } from "@overlay/ui/types";
import { Toggle } from "../controls";
import { OverlayPreview, type PreviewMeasure } from "../preview/OverlayPreview";
import "./overlays.css";
import { OverlayPanel, type SendPatch } from "./OverlayPanel";
import { listOverlays, settingsOf, simState, type SimContext } from "./model";

export interface OverlaysFormProps {
  manifests: readonly OverlayManifest[];
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
}

/** The first active overlay, else the first listed one. */
export function defaultSelection(
  manifests: readonly OverlayManifest[],
  all: OverlaysFormProps["all"],
  developerEnabled: boolean,
): string | null {
  const { active, available } = listOverlays(manifests, all, developerEnabled);
  return (active[0] ?? available[0])?.id ?? null;
}

/** The measurements only matter to the column width floor, which the column editor owns. */
const ignoreMeasure = (measure: PreviewMeasure): void => void measure;

export function OverlaysForm(props: OverlaysFormProps) {
  const { manifests, all, developerEnabled, sim, prefs } = props;
  const { active, available } = listOverlays(manifests, all, developerEnabled);
  const selected =
    [...active, ...available].find((m) => m.id === props.selectedId) ?? active[0] ?? available[0];
  const group = (title: string, list: OverlayManifest[]) => (
    <section className="ov-group" aria-label={title}>
      <h2>{title}</h2>
      {list.length === 0 && <p className="muted">None</p>}
      <ul className="ov-list">
        {list.map((m) => {
          const state = simState(m.sims, sim);
          const enabled = settingsOf(m, all).enabled;
          return (
            <li
              key={m.id}
              className="ov-item"
              data-selected={m.id === selected?.id || undefined}
              aria-disabled={state.disabled || undefined}
            >
              <button
                type="button"
                className="ov-item-main"
                aria-current={m.id === selected?.id ? "true" : undefined}
                onClick={() => props.onSelect(m.id)}
              >
                <span className="ov-item-title">
                  {m.title}
                  {state.badge && <em className="ctl-badge">{state.badge}</em>}
                </span>
                <small className="muted">{m.description}</small>
              </button>
              <Toggle
                label={`Enable ${m.title}`}
                checked={enabled}
                disabled={state.disabled && !enabled}
                onChange={(next) => props.onToggle(m.id, next)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
  return (
    <div className="ov-page">
      <div className="ov-left">
        {group("Active overlays", active)}
        {group("Available overlays", available)}
      </div>
      <aside className="ov-preview" aria-label="Preview">
        {selected && (
          <OverlayPreview
            key={selected.id}
            manifest={selected}
            settings={settingsOf(selected, all)}
            size={props.sizes[selected.id] ?? null}
            onMeasure={ignoreMeasure}
          />
        )}
      </aside>
      <div className="ov-right">
        {selected ? (
          <OverlayPanel
            key={selected.id}
            manifest={selected}
            settings={settingsOf(selected, all)}
            sim={sim}
            prefs={prefs}
            send={(patch, key) => props.send(selected.id, patch, key)}
            onReset={() => props.onReset(selected.id)}
          />
        ) : (
          <p className="muted">No overlays.</p>
        )}
      </div>
    </div>
  );
}
