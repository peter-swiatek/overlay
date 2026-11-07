import { describe, expect, it } from "vitest";
import {
  OPACITY_WORKAROUND_VALUE,
  buildOverlayWindowOptions,
  buildMainWindowOptions,
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

describe("buildMainWindowOptions", () => {
  it("is a resizable 1280x820 window titled Overlay with a 1000x680 minimum", () => {
    const options = buildMainWindowOptions("/p/index.cjs");
    expect(options).toMatchObject({
      width: 1280,
      height: 820,
      minWidth: 1000,
      minHeight: 680,
      resizable: true,
      title: "Overlay",
      show: false,
    });
    expect(options).not.toHaveProperty("x");
  });

  it("uses a saved position and size", () => {
    expect(
      buildMainWindowOptions("/p/index.cjs", { x: 5, y: 6, width: 1100, height: 700 }),
    ).toMatchObject({ x: 5, y: 6, width: 1100, height: 700 });
  });

  it("is sandboxed and isolated", () => {
    expect(buildMainWindowOptions("/p/index.cjs").webPreferences).toMatchObject({
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
