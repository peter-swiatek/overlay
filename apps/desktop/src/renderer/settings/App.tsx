import { useEffect, useState } from "react";
import type { AppInfo } from "../../shared/types";
import { useAppSettings } from "./controls/useAppSettings";
import { SETTINGS_PAGES } from "./pages";
import { TopBar } from "./shell/TopBar";
import { Welcome } from "./shell/Welcome";
import { railGroups, resolvePageId, visiblePages, zoomOf } from "./shell-model";

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
  const [wanted, setWanted] = useState<string | null>(readLastPage);
  const { settings } = useAppSettings();

  useEffect(() => {
    void window.overlayApi.getAppInfo().then(setInfo);
  }, []);

  const pages = visiblePages(SETTINGS_PAGES, settings?.developer.enabled ?? false);
  const page = pages.find((p) => p.id === resolvePageId(pages, wanted));
  const Page = page?.Component;

  // CSS zoom, not webContents.setZoomFactor: that is shared per origin and would scale overlays too.
  const style = settings ? { zoom: zoomOf(settings.general.uiScalePct) } : undefined;

  return (
    <div className="shell" style={style}>
      <TopBar />
      <div className="shell-body">
        <aside className="rail">
          <nav aria-label="Pages">
            {railGroups(pages).map((group) => (
              <div key={group.id} className="rail-group" data-group={group.id}>
                {group.title && <h2 className="rail-heading">{group.title}</h2>}
                {group.pages.map((p) => (
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
              </div>
            ))}
          </nav>
          <p className="rail-version muted">Version {info?.build.displayVersion ?? "..."}</p>
        </aside>
        <main className="content">
          {page && <h2 className="page-title">{page.label}</h2>}
          {page?.id === "overlays" && <Welcome />}
          {Page && <Page />}
        </main>
      </div>
    </div>
  );
}
