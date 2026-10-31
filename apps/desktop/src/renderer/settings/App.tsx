import { useEffect, useState } from "react";
import type { TelemetryEvent } from "../../shared/telemetry-types";
import type { AppInfo } from "../../shared/types";
import { useAppSettings } from "./controls/useAppSettings";
import { SETTINGS_PAGES } from "./pages";
import { resolvePageId, statusLabel, statusTone, visiblePages, zoomOf } from "./shell-model";

const PAGE_KEY = "settings.lastPage";

function readLastPage(): string | null {
  try {
    return localStorage.getItem(PAGE_KEY);
  } catch {
    return null;
  }
}

function rememberPage(id: string): void {
  try {
    localStorage.setItem(PAGE_KEY, id);
  } catch {
    // Storage can be unavailable; the page is simply not remembered.
  }
}

export function App() {
  const [info, setInfo] = useState<AppInfo>();
  const [status, setStatus] = useState<TelemetryEvent | null>(null);
  const [wanted, setWanted] = useState<string | null>(readLastPage);
  const { settings } = useAppSettings();

  useEffect(() => {
    const api = window.overlayApi;
    void api.getAppInfo().then(setInfo);
    void api.telemetry.getStatus().then(setStatus);
    return api.telemetry.onStatus(setStatus);
  }, []);

  const pages = visiblePages(SETTINGS_PAGES, settings?.developer.enabled ?? false);
  const page = pages.find((p) => p.id === resolvePageId(pages, wanted));
  const Page = page?.Component;

  // CSS zoom, not webContents.setZoomFactor: that is shared per origin and would scale overlays too.
  const style = settings ? { zoom: zoomOf(settings.general.uiScalePct) } : undefined;

  return (
    <div className="shell" style={style}>
      <aside className="rail">
        <div className="rail-head">
          <h1>Overlay</h1>
          <p className="muted">Version {info?.build.displayVersion ?? "..."}</p>
        </div>
        <nav aria-label="Settings pages">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === page?.id ? "page" : undefined}
              onClick={() => {
                setWanted(p.id);
                rememberPage(p.id);
              }}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <p className="rail-status" role="status">
          <span className="dot" data-tone={statusTone(status)} aria-hidden="true" />
          {statusLabel(status)}
        </p>
      </aside>
      <main className="content">
        {page && <h2 className="page-title">{page.label}</h2>}
        {Page && <Page />}
      </main>
    </div>
  );
}
