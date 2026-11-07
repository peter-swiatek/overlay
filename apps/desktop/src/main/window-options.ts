import type { BrowserWindowConstructorOptions } from "electron";
import type { Bounds } from "../shared/types";
import { DEFAULT_MAIN_SIZE, MIN_MAIN_SIZE, type MainWindowState } from "./main-window";

export const OPACITY_WORKAROUND_VALUE = 0.99;

export interface OverlayWindowInput {
  bounds: Bounds;
  preloadPath: string;
}

/** Pure builder for the BrowserWindow options of every overlay window. */
export function buildOverlayWindowOptions(
  input: OverlayWindowInput,
): BrowserWindowConstructorOptions {
  const { bounds, preloadPath } = input;
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    transparent: true,
    frame: false,
    // Electron transparent windows cannot be resized by the OS; we resize via setBounds.
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}

/** Pure builder for the main window ("Overlay"). `state` comes from `clampMainWindowState`. */
export function buildMainWindowOptions(
  preloadPath: string,
  state?: Pick<MainWindowState, "x" | "y" | "width" | "height">,
): BrowserWindowConstructorOptions {
  const size = state ?? DEFAULT_MAIN_SIZE;
  return {
    ...(state?.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    width: size.width,
    height: size.height,
    minWidth: MIN_MAIN_SIZE.width,
    minHeight: MIN_MAIN_SIZE.height,
    resizable: true,
    show: false,
    title: "Overlay",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}
