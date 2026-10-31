import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import type { SimName } from "@overlay/sim-core/types";
import type { DisplayPrefs } from "@overlay/ui/types";
import { Segmented, Toggle } from "../controls";
import "./overlays.css";
import { OverlayPanel, type SendPatch } from "./OverlayPanel";
import { listOverlays, settingsOf, simState } from "./model";

export interface OverlaysFormProps {
  manifests: readonly OverlayManifest[];
  all: Readonly<Record<string, OverlayInstanceSettings>>;
  developerEnabled: boolean;
  selectedId: string | null;
  sim: SimName;
  prefs: DisplayPrefs;
  onSelect(id: string): void;
  onToggle(id: string, enabled: boolean): void;
  onSim(sim: SimName): void;
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
                disabled={state.disabled}
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
        <Segmented<SimName>
          label="Sim filter"
          value={sim}
          options={[
            { value: "iracing", label: "iRacing" },
            { value: "lmu", label: "LMU" },
          ]}
          onChange={props.onSim}
        />
        {group("Active overlays", active)}
        {group("Available overlays", available)}
      </div>
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
