import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

const rendererDir = join(import.meta.dirname, "../renderer");

/** Absolute path of the sandboxed preload (emitted as CommonJS). */
export const preloadPath = join(import.meta.dirname, "../preload/index.cjs");

export function loadPage(
  win: BrowserWindow,
  page: "settings" | "overlay",
  query: Record<string, string> = {},
): Promise<void> {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devUrl) {
    const qs = new URLSearchParams(query).toString();
    return win.loadURL(`${devUrl}/${page}/index.html${qs ? `?${qs}` : ""}`);
  }
  return win.loadFile(join(rendererDir, page, "index.html"), { query });
}
