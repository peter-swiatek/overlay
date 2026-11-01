import type { AppSettings } from "../shared/app-settings-types";
import type { Bounds, Size } from "../shared/types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";
import { clampToWorkArea, isReachable } from "./layout";

/** What to do at process start. */
export interface LaunchPlan {
  /** False means start hidden in the tray with no window. */
  showWindow: boolean;
}

/** The flag the login item is registered with (`app.setLoginItemSettings({ args })`). */
export const HIDDEN_ARG = "--hidden";

/**
 * Pure: decides whether the main window opens at start. Windows does not report
 * `wasOpenedAtLogin`, so the `--hidden` argument is the signal. Starting by hand (no flag)
 * always shows the window.
 *
 * @param argv process.argv
 * @param settings stored app settings (`general.startHiddenAtLogin`)
 */
export function launchPlan(argv: readonly string[], settings: AppSettings): LaunchPlan {
  const hidden = argv.includes(HIDDEN_ARG) && settings.general.startHiddenAtLogin;
  return { showWindow: !hidden };
}

export interface CloseInput {
  closeAction: AppSettings["general"]["closeAction"];
  /** True once the app is quitting (tray Quit, updater, OS shutdown). */
  quitting: boolean;
  trayNoticeShown: boolean;
}

export interface CloseDecision {
  /** Cancel the close and hide the window instead. */
  hide: boolean;
  /** Quit the app (the close button with "Quit" selected). */
  quit: boolean;
  /** Show the one-time "still running" tray notice. */
  showNotice: boolean;
}

/** Pure: what the main window's close button does. */
export function decideClose(input: CloseInput): CloseDecision {
  if (input.quitting) return { hide: false, quit: false, showNotice: false };
  if (input.closeAction === "quit") return { hide: false, quit: true, showNotice: false };
  return { hide: true, quit: false, showNotice: !input.trayNoticeShown };
}

export const TRAY_NOTICE = {
  title: "Overlay",
  content: "Overlay is still running. Open it from the tray icon.",
} as const;

export const DEFAULT_MAIN_SIZE: Size = { width: 1280, height: 820 };
export const MIN_MAIN_SIZE: Size = { width: 1000, height: 680 };

/** What is kept in `main-window.json`. x and y are absent until the user has moved the window. */
export interface MainWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Parses a stored state; anything malformed gives undefined (defaults apply). */
export function parseMainWindowState(raw: unknown): MainWindowState | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const width = r["width"];
  const height = r["height"];
  if (!finite(width) || !finite(height)) return undefined;
  const state: MainWindowState = {
    width: Math.round(width),
    height: Math.round(height),
    maximized: r["maximized"] === true,
  };
  const x = r["x"];
  const y = r["y"];
  if (finite(x) && finite(y)) {
    state.x = Math.round(x);
    state.y = Math.round(y);
  }
  return state;
}

/** Reads `main-window.json`; undefined when missing or malformed. */
export function loadMainWindowState(file: string): MainWindowState | undefined {
  return parseMainWindowState(readJsonFile(file));
}

/** Writes `main-window.json`; a failed write is logged, never thrown. */
export function saveMainWindowState(file: string, state: MainWindowState): void {
  try {
    writeJsonFileAtomic(file, state);
  } catch (error) {
    console.error("Could not save main window state", error);
  }
}

/**
 * Pure: pulls a saved state back onto the screen. The size is at least the minimum and at most
 * the work area; a saved position that is not reachable on any display is dropped (the window
 * goes to the primary display) and otherwise the window is shrunk so it does not hang off the area.
 */
export function clampMainWindowState(
  state: MainWindowState | undefined,
  workAreas: readonly Bounds[],
  primary: Bounds,
  min: Size = MIN_MAIN_SIZE,
): MainWindowState {
  const base = state ?? { ...DEFAULT_MAIN_SIZE, maximized: false };
  const size = {
    width: Math.max(min.width, base.width),
    height: Math.max(min.height, base.height),
  };
  const onPrimary = (): MainWindowState => {
    const fit = clampToWorkArea({ x: primary.x, y: primary.y, ...size }, primary, min);
    return { width: fit.width, height: fit.height, maximized: base.maximized };
  };
  if (base.x === undefined || base.y === undefined) return onPrimary();
  const placed: Bounds = { x: base.x, y: base.y, ...size };
  const area = workAreas.find((a) => isReachable(placed, [a]));
  if (!area) return onPrimary();
  const fit = clampToWorkArea(placed, area, min);
  // Pull a window that starts left of or above the area back to its edge.
  const x = Math.max(area.x, Math.min(fit.x, area.x + area.width - fit.width));
  const y = Math.max(area.y, Math.min(fit.y, area.y + area.height - fit.height));
  return { x, y, width: fit.width, height: fit.height, maximized: base.maximized };
}
