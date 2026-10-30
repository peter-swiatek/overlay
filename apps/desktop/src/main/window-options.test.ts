import { describe, expect, it } from "vitest";
import {
  OPACITY_WORKAROUND_VALUE,
  buildOverlayWindowOptions,
  buildSettingsWindowOptions,
  overlayOpacity,
} from "./window-options";

describe("buildOverlayWindowOptions", () => {
  const options = buildOverlayWindowOptions({
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    preloadPath: "/p/index.cjs",
  });

  it("is a transparent, frameless, non-focusable, non-resizable window", () => {
    expect(options).toMatchObject({
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      show: false,
    });
  });

  it("uses the given bounds", () => {
    expect(options).toMatchObject({ x: 10, y: 20, width: 300, height: 200 });
  });

  it("is sandboxed and isolated", () => {
    expect(options.webPreferences).toEqual({
      preload: "/p/index.cjs",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});

describe("buildSettingsWindowOptions", () => {
  it("is sandboxed and isolated", () => {
    expect(buildSettingsWindowOptions("/p/index.cjs").webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});

describe("overlayOpacity", () => {
  it("is opaque normally and 0.99 with the workaround", () => {
    expect(overlayOpacity(false)).toBe(1);
    expect(overlayOpacity(true)).toBe(OPACITY_WORKAROUND_VALUE);
    expect(OPACITY_WORKAROUND_VALUE).toBe(0.99);
  });
});
