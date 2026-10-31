import { useEffect, useState } from "react";
import type { AppInfo } from "../../shared/types";
import { SETTINGS_PAGES, type SettingsPageId } from "./pages";

export function App() {
  const [info, setInfo] = useState<AppInfo>();
  const [pageId, setPageId] = useState<SettingsPageId>(SETTINGS_PAGES[0]?.id ?? "overlays");

  useEffect(() => {
    void window.overlayApi.getAppInfo().then(setInfo);
  }, []);

  const page = SETTINGS_PAGES.find((p) => p.id === pageId) ?? SETTINGS_PAGES[0];
  const Page = page?.Component;

  return (
    <main>
      <h1>Overlay</h1>
      <p className="muted">Version {info?.build.displayVersion ?? "..."}</p>
      <nav aria-label="Settings pages">
        {SETTINGS_PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={p.id === page?.id ? "page" : undefined}
            onClick={() => setPageId(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      {Page && <Page />}
    </main>
  );
}
