import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GRAPHITE, THEME_PRESETS, lockedCssVars, themeToCssVars } from "@overlay/theme";
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

describe("applyThemeToRoot", () => {
  it("writes the theme variables and data-compact", () => {
    const root = fakeRoot();
    const carbon = THEME_PRESETS.find((t) => t.id === "carbon");
    if (!carbon) throw new Error("no carbon");
    applyThemeToRoot(root, carbon);
    expect(root.vars).toEqual(themeToCssVars(carbon));
    expect(root.dataset.compact).toBe("true");
    applyThemeToRoot(root, GRAPHITE);
    expect(root.dataset.compact).toBe("false");
  });

  it("writes data-tone: light only for Glacier", () => {
    for (const t of THEME_PRESETS) {
      const root = fakeRoot();
      applyThemeToRoot(root, t);
      expect(root.dataset.tone).toBe(t.id === "glacier" ? "light" : "dark");
    }
  });

  it("never touches locked variables", () => {
    const root = fakeRoot();
    applyThemeToRoot(root, GRAPHITE);
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
  it("matches Graphite and the locked colours", () => {
    const css = readFileSync(new URL("./defaults.css", import.meta.url), "utf8");
    const rootBlock = /:root \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const declared: Record<string, string> = {};
    for (const [, name, value] of rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      declared[name as string] = (value as string).trim();
    }
    expect(declared).toEqual({ ...themeToCssVars(GRAPHITE), ...lockedCssVars() });
  });
});
