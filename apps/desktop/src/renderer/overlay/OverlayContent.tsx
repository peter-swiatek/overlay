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
  /** The instance's name for the title bar. */
  title?: string;
}

/** Decides what the overlay window shows (component, notice or nothing) and frames it. */
export function OverlayContent({ module, settings, autoHide, view, editing, title }: Props) {
  const { manifest, Component } = module;
  const visibility = overlayVisibility({
    live: view.live,
    playerOnTrack: view.playerOnTrack,
    sim: view.sim,
    manifestSims: manifest.sims,
    common: settings.common,
    autoHide,
    editing,
    needsTelemetry: manifest.needsTelemetry ?? true,
  });
  if (visibility === "hidden") return null;
  if (visibility === "unsupported" && !editing) return null;

  return (
    <OverlayFrame
      manifest={manifest}
      common={settings.common}
      editing={editing}
      {...(title === undefined ? {} : { title })}
    >
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
