import { useEffect, useState } from "react";
import type { TelemetryEvent, TelemetrySourceChoice } from "../../../shared/telemetry-types";
import type { AppInfo, AppState } from "../../../shared/types";
import { Segmented, Toggle } from "../controls";
import { useAppSettings } from "../controls/useAppSettings";
import { flushPendingSettings } from "../overlays/debounce";
import { gameOptions, statusLabel, statusTone } from "../shell-model";

export interface TopBarViewProps {
  version: string;
  source: TelemetrySourceChoice;
  developerEnabled: boolean;
  status: TelemetryEvent | null;
  /** Null until the first read; the toggles are disabled until then. */
  appState: AppState | null;
  onSource(choice: TelemetrySourceChoice): void;
  onVisible(visible: boolean): void;
  onLocked(locked: boolean): void;
  onQuit(): void;
}

/** The "..." button with a one-item menu. Closes on any pick, Escape or outside click. */
export function OverflowMenu({ onQuit }: { onQuit(): void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="topbar-menu">
      <button
        type="button"
        className="topbar-more"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        &#8943;
      </button>
      {open && (
        <div className="topbar-popup" role="menu">
          <button type="button" role="menuitem" onClick={onQuit}>
            Quit Overlay
          </button>
        </div>
      )}
    </div>
  );
}

/** The bar itself, separate from the IPC hooks so it renders and clicks with fake props. */
export function TopBarView(props: TopBarViewProps) {
  const { appState } = props;
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <strong>Overlay</strong>
        <span className="muted">{props.version}</span>
      </div>
      <Segmented
        label="Game"
        value={props.source}
        options={gameOptions(props.source, props.developerEnabled)}
        onChange={props.onSource}
      />
      <span className="topbar-status" role="status">
        <span className="dot" data-tone={statusTone(props.status)} aria-hidden="true" />
        {statusLabel(props.status)}
      </span>
      <span className="topbar-spacer" />
      <label className="topbar-toggle">
        Visible
        <Toggle
          label="Visible"
          checked={appState?.overlaysVisible ?? true}
          disabled={!appState}
          onChange={props.onVisible}
        />
      </label>
      <label className="topbar-toggle">
        Locked
        <Toggle
          label="Locked"
          checked={appState?.overlaysLocked ?? true}
          disabled={!appState}
          onChange={props.onLocked}
        />
      </label>
      <OverflowMenu onQuit={props.onQuit} />
    </header>
  );
}

/** Quits after sending any slider change that is still waiting out its delay. */
export function quitApp(quit: () => Promise<void> | void): void {
  flushPendingSettings();
  void quit();
}

export function TopBar() {
  const { settings } = useAppSettings();
  const [info, setInfo] = useState<AppInfo>();
  const [source, setSource] = useState<TelemetrySourceChoice>("auto");
  const [status, setStatus] = useState<TelemetryEvent | null>(null);
  const [appState, setAppState] = useState<AppState | null>(null);

  useEffect(() => {
    const api = window.overlayApi;
    let alive = true;
    void api.getAppInfo().then((i) => alive && setInfo(i));
    void api.telemetry.getSource().then((v) => alive && setSource(v.source));
    void api.telemetry.getStatus().then((s) => alive && setStatus(s));
    void api.appState.get().then((s) => alive && setAppState(s));
    const offs = [
      api.telemetry.onSourceChanged((v) => setSource(v.source)),
      api.telemetry.onStatus(setStatus),
      api.appState.onChanged(setAppState),
    ];
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, []);

  const api = window.overlayApi;
  return (
    <TopBarView
      version={info?.build.displayVersion ?? "..."}
      source={source}
      developerEnabled={settings?.developer.enabled ?? false}
      status={status}
      appState={appState}
      onSource={(choice) => {
        if (choice === "replay") {
          void api.telemetry.pickReplayFile().then((v) => setSource(v.source));
        } else {
          void api.telemetry.setSource(choice).then((v) => setSource(v.source));
        }
      }}
      onVisible={(overlaysVisible) => void api.appState.set({ overlaysVisible }).then(setAppState)}
      onLocked={(overlaysLocked) => void api.appState.set({ overlaysLocked }).then(setAppState)}
      onQuit={() => quitApp(() => api.quit())}
    />
  );
}
