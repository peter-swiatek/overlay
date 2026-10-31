import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import type { OverlayModule } from "@overlay/overlays";
import { OverlayErrorBoundary } from "./ErrorBoundary";
import { OverlayFrame } from "./OverlayFrame";
import { overlayVisibility, unsupportedNote, type HostView } from "./visibility";

interface Props {
  module: OverlayModule;
  settings: OverlayInstanceSettings;
  autoHide: boolean;
  view: HostView;
  editing: boolean;
}

/** Decides what the overlay window shows (component, notice or nothing) and frames it. */
export function OverlayContent({ module, settings, autoHide, view, editing }: Props) {
  const { manifest, Component } = module;
  const visibility = overlayVisibility({
    live: view.live,
    playerOnTrack: view.playerOnTrack,
    sim: view.sim,
    manifestSims: manifest.sims,
    common: settings.common,
    autoHide,
    editing,
  });
  if (visibility === "hidden") return null;
  if (visibility === "unsupported" && !editing) return null;

  return (
    <OverlayFrame manifest={manifest} common={settings.common} editing={editing}>
      {visibility === "notice" && <div className="panel notice">{view.notice ?? "No data"}</div>}
      {visibility === "unsupported" && (
        <div className="panel notice">{unsupportedNote(view.sim)}</div>
      )}
      {visibility === "show" && (
        <OverlayErrorBoundary resetKey={settings} name={manifest.id}>
          <Component settings={settings} />
        </OverlayErrorBoundary>
      )}
    </OverlayFrame>
  );
}
