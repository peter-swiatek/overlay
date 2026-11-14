import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TYPOGRAPHY,
  GRAPHITE,
  THEME_PRESETS,
  lockedCssVars,
  themeToCssVars,
  typographyToCssVars,
} from "@overlay/theme";
import type { Theme, Typography } from "@overlay/theme/types";
import { applyLockedToRoot, applyThemeToRoot, type ThemeRoot } from "./apply";

function fakeRoot(): ThemeRoot & { vars: Record<string, string> } {
  const vars: Record<string, string> = {};
  return {
    vars,
    style: {
      setProperty: (name, value) => {
        vars[name] = value;
      },
    },
    dataset: {},
  };
}

const applied = (theme: Theme, typography: Typography = DEFAULT_TYPOGRAPHY) => ({
  theme,
  typography,
});

describe("applyThemeToRoot", () => {
  it("writes the theme and typography variables and data-compact from the typography", () => {
    const root = fakeRoot();
    const carbon = THEME_PRESETS.find((t) => t.id === "carbon");
    if (!carbon) throw new Error("no carbon");
    const compact = { ...DEFAULT_TYPOGRAPHY, compact: true };
    applyThemeToRoot(root, applied(carbon, compact));
    expect(root.vars).toEqual(themeToCssVars(carbon, compact));
    expect(root.dataset.compact).toBe("true");
    applyThemeToRoot(root, applied(carbon));
    expect(root.dataset.compact).toBe("false");
  });

  it("keeps the same typography variables whichever theme is applied", () => {
    const typography: Typography = { font: "barlow-condensed", weight: 800, compact: true };
    for (const t of THEME_PRESETS) {
      const root = fakeRoot();
      applyThemeToRoot(root, applied(t, typography));
      expect(root.vars).toMatchObject(typographyToCssVars(typography));
      expect(root.dataset.compact).toBe("true");
    }
  });

  it("writes data-tone: light only for Glacier", () => {
    for (const t of THEME_PRESETS) {
      const root = fakeRoot();
      applyThemeToRoot(root, applied(t));
      expect(root.dataset.tone).toBe(t.id === "glacier" ? "light" : "dark");
    }
  });

  it("never touches locked variables", () => {
    const root = fakeRoot();
    applyThemeToRoot(root, applied(GRAPHITE));
    expect(Object.keys(root.vars).some((k) => k.startsWith("--ov-locked-"))).toBe(false);
  });
});

describe("applyLockedToRoot", () => {
  it("writes every locked variable", () => {
    const root = fakeRoot();
    applyLockedToRoot(root);
    expect(root.vars).toEqual(lockedCssVars());
  });
});

describe("defaults.css", () => {
  it("matches Graphite, the default typography and the locked colours", () => {
    const css = readFileSync(new URL("./defaults.css", import.meta.url), "utf8");
    const rootBlock = /:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const declared: Record<string, string> = {};
    for (const [, name, value] of rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      declared[name as string] = (value as string).trim();
    }
    expect(declared).toEqual({
      ...themeToCssVars(GRAPHITE, DEFAULT_TYPOGRAPHY),
      ...lockedCssVars(),
    });
  });
});
