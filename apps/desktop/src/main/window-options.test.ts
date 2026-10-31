import { describe, expect, it } from "vitest";
import {
  OPACITY_WORKAROUND_VALUE,
  buildOverlayWindowOptions,
  buildSettingsWindowOptions,
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
  it("is a resizable 920x680 window with a 760x560 minimum", () => {
    expect(buildSettingsWindowOptions("/p/index.cjs")).toMatchObject({
      width: 920,
      height: 680,
      minWidth: 760,
      minHeight: 560,
      resizable: true,
    });
  });

  it("is sandboxed and isolated", () => {
    expect(buildSettingsWindowOptions("/p/index.cjs").webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});

describe("OPACITY_WORKAROUND_VALUE", () => {
  it("is 0.99", () => {
    expect(OPACITY_WORKAROUND_VALUE).toBe(0.99);
  });
});
