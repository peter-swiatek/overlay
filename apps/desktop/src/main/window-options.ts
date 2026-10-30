import type { BrowserWindowConstructorOptions } from "electron";
import type { Bounds } from "../shared/types";

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

export function buildSettingsWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 560,
    height: 640,
    show: false,
    title: "Overlay settings",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}

/** Value for setOpacity: 0.99 forces a different compositing path on some GPUs. */
export function overlayOpacity(opacityWorkaround: boolean): number {
  return opacityWorkaround ? OPACITY_WORKAROUND_VALUE : 1;
}
