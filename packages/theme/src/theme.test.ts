import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  LOCKED_COLOURS,
  LOCKED_COLOUR_KEYS,
  THEME_PRESETS,
  THEME_TOKEN_KEYS,
  compositeOver,
  contrastOfRgb,
  contrastRatio,
  decodeThemeCode,
  encodeThemeCode,
  forkTheme,
  lockedCssVars,
  overBlack,
  parseThemeFile,
  resolveFunctionalColour,
  sanitizeTheme,
  serializeThemeFile,
  themeToCssVars,
  type Theme,
} from "./index";

const DENY = [
  "blue steel",
  "crimson",
  "racing green",
  "sunset",
  "ultraviolet",
  "default",
  "alternative",
];

const graphite = THEME_PRESETS[0] as Theme;
const seq = (): (() => number) => {
  let i = 0;
  return () => (i++ % 36) / 36;
};

describe("presets", () => {
  it("has six presets with unique ids and names, none on the denylist", () => {
    expect(THEME_PRESETS.map((t) => t.name)).toEqual([
      "Graphite",
      "Midnight",
      "Carbon",
      "Paddock",
      "Glacier",
      "Aurora",
    ]);
    expect(new Set(THEME_PRESETS.map((t) => t.id)).size).toBe(6);
    for (const t of THEME_PRESETS) expect(DENY).not.toContain(t.name.toLowerCase());
  });

  it("keeps Graphite exactly as shipped", () => {
    expect(graphite).toEqual({
      id: "graphite",
      name: "Graphite",
      tokens: {
        backgroundTint: "#0a0c10b8",
        row: "#00000000",
        rowAlt: "#ffffff0a",
        header: "#ffffff14",
        accent: "#ffc400",
        text: "#f2f4f8",
        textMuted: "#c4c9d2",
        border: "#ffffff1f",
        ownRow: "#ffc40047",
      },
      font: "inter",
      weight: 500,
      compact: false,
    });
    expect(DEFAULT_THEME_ID).toBe(graphite.id);
  });

  it("has distinct accents", () => {
    expect(new Set(THEME_PRESETS.map((t) => t.tokens.accent)).size).toBe(6);
  });

  it.each(THEME_PRESETS.map((t) => [t.name, t] as const))("%s sanitises to itself", (_n, t) => {
    expect(sanitizeTheme(t)).toEqual({ ok: true, theme: t });
  });

  it.each(THEME_PRESETS.map((t) => [t.name, t] as const))("%s has readable text", (_n, t) => {
    const base = overBlack(t.tokens.backgroundTint);
    if (!base) throw new Error("bad tint");
    const surface = (key: "row" | "rowAlt" | "header" | "ownRow") => {
      const c = compositeOver(t.tokens[key], base);
      if (!c) throw new Error("bad token");
      return c;
    };
    const textOn = (key: "text" | "textMuted", bg: ReturnType<typeof surface>) => {
      const fg = compositeOver(t.tokens[key], bg);
      if (!fg) throw new Error("bad token");
      return contrastOfRgb(fg, bg);
    };
    for (const key of ["row", "rowAlt", "header", "ownRow"] as const) {
      expect(textOn("text", surface(key))).toBeGreaterThanOrEqual(4.5);
      expect(textOn("textMuted", surface(key))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("locked colours", () => {
  it("matches the pinned values", () => {
    expect(LOCKED_COLOURS).toMatchInlineSnapshot(`
      {
        "fastest": "#a855f7",
        "flagBlack": "#111111",
        "flagBlue": "#2563eb",
        "flagGreen": "#16a34a",
        "flagRed": "#dc2626",
        "flagWhite": "#f8fafc",
        "flagYellow": "#facc15",
        "gain": "#22c55e",
        "lapFaster": "#22c55e",
        "lapSlower": "#ef4444",
        "licenceA": "#2f6fde",
        "licenceB": "#3bb54a",
        "licenceC": "#f2c12e",
        "licenceD": "#f28c28",
        "licencePro": "#1a1a1a",
        "licenceR": "#e0322c",
        "loss": "#ef4444",
        "rejoinRed": "#ef4444",
        "rejoinYellow": "#facc15",
      }
    `);
  });

  it("is frozen and has every key", () => {
    expect(Object.isFrozen(LOCKED_COLOURS)).toBe(true);
    expect(Object.keys(LOCKED_COLOURS).sort()).toEqual([...LOCKED_COLOUR_KEYS].sort());
  });

  it("emits one kebab-case variable per key", () => {
    const vars = lockedCssVars();
    expect(Object.keys(vars)).toHaveLength(LOCKED_COLOUR_KEYS.length);
    expect(vars["--ov-locked-licence-pro"]).toBe("#1a1a1a");
    expect(vars["--ov-locked-flag-blue"]).toBe("#2563eb");
    expect(vars["--ov-locked-gain"]).toBe("#22c55e");
  });
});

describe("sanitizeTheme", () => {
  const valid = { ...graphite, id: "custom-abcd1234" };

  it("reports a missing token in plain words", () => {
    const tokens: Partial<Theme["tokens"]> = { ...valid.tokens };
    delete tokens.accent;
    expect(sanitizeTheme({ ...valid, tokens })).toEqual({
      ok: false,
      error: "This theme is missing the accent colour",
    });
  });

  it("rejects a bad colour and non-objects", () => {
    expect(sanitizeTheme({ ...valid, tokens: { ...valid.tokens, text: "red" } }).ok).toBe(false);
    expect(sanitizeTheme({ ...valid, tokens: { ...valid.tokens, text: "#fff" } }).ok).toBe(false);
    expect(sanitizeTheme(null).ok).toBe(false);
    expect(sanitizeTheme("x").ok).toBe(false);
    expect(sanitizeTheme({ ...valid, tokens: undefined }).ok).toBe(false);
  });

  it("lower-cases colours and falls back for font, weight and compact", () => {
    const r = sanitizeTheme({
      ...valid,
      tokens: { ...valid.tokens, accent: "#FFC400" },
      font: "comic",
      weight: 550,
      compact: "yes",
    });
    expect(r.ok && r.theme).toMatchObject({
      tokens: { accent: "#ffc400" },
      font: "inter",
      weight: 500,
      compact: false,
    });
  });

  it("cleans names", () => {
    const name = (n: unknown) => {
      const r = sanitizeTheme({ ...valid, name: n });
      return r.ok ? r.theme.name : null;
    };
    expect(name("  A\u0000B\n ")).toBe("AB");
    expect(name("")).toBe("Imported theme");
    expect(name("\u0007")).toBe("Imported theme");
    expect(name(7)).toBe("Imported theme");
    expect(name("x".repeat(60))).toBe("x".repeat(40));
  });

  it("ignores extra keys, including locked colours at any depth", () => {
    const r = sanitizeTheme({
      ...valid,
      gain: "#000000",
      lockedColours: { gain: "#000000" },
      tokens: { ...valid.tokens, gain: "#000000", nested: { loss: "#000000" } },
    });
    expect(r).toEqual({ ok: true, theme: valid });
  });
});

describe("forkTheme", () => {
  it("names and ids a copy", () => {
    const fork = forkTheme(graphite, THEME_PRESETS, seq());
    expect(fork.id).toBe("custom-01234567");
    expect(fork.name).toBe("Graphite (custom)");
    expect(fork.tokens).toEqual(graphite.tokens);
    expect(fork.tokens).not.toBe(graphite.tokens);
  });

  it("makes names unique", () => {
    const one = forkTheme(graphite, THEME_PRESETS);
    const two = forkTheme(graphite, [...THEME_PRESETS, one]);
    const three = forkTheme(graphite, [...THEME_PRESETS, one, two]);
    expect(two.name).toBe("Graphite (custom) 2");
    expect(three.name).toBe("Graphite (custom) 3");
    expect(three.id).toMatch(/^custom-[0-9a-z]{8}$/);
  });

  it("keeps long names within 40 characters", () => {
    const long = { ...graphite, name: "n".repeat(40) };
    const fork = forkTheme(long, []);
    expect(Array.from(fork.name).length).toBeLessThanOrEqual(40);
    expect(fork.name.endsWith(" (custom)")).toBe(true);
  });
});

describe("share code", () => {
  it.each(THEME_PRESETS.map((t) => [t.name, t] as const))("round trips %s", (_n, t) => {
    const code = encodeThemeCode(t);
    expect(code.startsWith("OVT1.")).toBe(true);
    const r = decodeThemeCode(code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.theme.id).toMatch(/^custom-[0-9a-z]{8}$/);
    expect({ ...r.theme, id: t.id }).toEqual(t);
  });

  it("tolerates whitespace and line breaks", () => {
    const code = encodeThemeCode(graphite);
    const wrapped = `  ${code.slice(0, 20)}\n${code.slice(20, 50)}\r\n ${code.slice(50)} \n`;
    expect(decodeThemeCode(wrapped).ok).toBe(true);
  });

  it("round trips non-ASCII names", () => {
    const r = decodeThemeCode(encodeThemeCode({ ...graphite, name: "Zażółć" }));
    expect(r.ok && r.theme.name).toBe("Zażółć");
  });

  it("rejects wrong prefix, truncation, length and bad data", () => {
    const code = encodeThemeCode(graphite);
    expect(decodeThemeCode(code.replace("OVT1.", "OVT2.")).ok).toBe(false);
    expect(decodeThemeCode(code.slice(0, 30)).ok).toBe(false);
    expect(decodeThemeCode(`OVT1.${"A".repeat(5000)}`)).toEqual({
      ok: false,
      error: "This code is too long",
    });
    expect(decodeThemeCode("OVT1.!!!!").ok).toBe(false);
    expect(decodeThemeCode("OVT1.A").ok).toBe(false);
    const notJson = `OVT1.${btoa("hello").replace(/=+$/, "")}`;
    expect(decodeThemeCode(notJson).ok).toBe(false);
    expect(decodeThemeCode("").ok).toBe(false);
  });

  it("ignores locked colours smuggled into a code", () => {
    const before = { ...LOCKED_COLOURS };
    const json = JSON.stringify({
      ...graphite,
      gain: "#000000",
      lockedColours: { gain: "#000000", loss: "#000000" },
      tokens: { ...graphite.tokens, gain: "#000000" },
    });
    const bytes = new TextEncoder().encode(json);
    const b64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const r = decodeThemeCode(`OVT1.${b64}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.theme).sort()).toEqual([
      "compact",
      "font",
      "id",
      "name",
      "tokens",
      "weight",
    ]);
    expect(Object.keys(r.theme.tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
    expect(LOCKED_COLOURS).toEqual(before);
  });
});

describe("theme file", () => {
  it("round trips and has the documented shape", () => {
    const text = serializeThemeFile(graphite);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ format: "overlay-theme", version: 1, name: "Graphite" });
    expect(parsed.id).toBeUndefined();
    const r = parseThemeFile(text);
    expect(r.ok && { ...r.theme, id: "graphite" }).toEqual(graphite);
    expect(r.ok && r.theme.id.startsWith("custom-")).toBe(true);
  });

  it("checks format, version, size and JSON", () => {
    const base = JSON.parse(serializeThemeFile(graphite)) as object;
    expect(parseThemeFile("nope").ok).toBe(false);
    expect(parseThemeFile("[]").ok).toBe(false);
    expect(parseThemeFile(JSON.stringify({ ...base, format: "x" })).ok).toBe(false);
    expect(parseThemeFile(JSON.stringify({ ...base, version: 2 })).ok).toBe(false);
    expect(parseThemeFile(" ".repeat(70000)).ok).toBe(false);
  });
});

describe("css variables", () => {
  it("lists tokens in order, then typography", () => {
    expect(Object.keys(themeToCssVars(graphite))).toEqual([
      "--ov-bg",
      "--ov-row",
      "--ov-row-alt",
      "--ov-header",
      "--ov-accent",
      "--ov-text",
      "--ov-text-muted",
      "--ov-border",
      "--ov-own-row",
      "--ov-font-family",
      "--ov-font-weight",
      "--ov-font-size",
      "--ov-row-height",
      "--ov-cell-pad-x",
    ]);
  });

  it("maps fonts and compact mode", () => {
    const vars = themeToCssVars(graphite);
    expect(vars["--ov-font-family"]).toBe('"Inter", system-ui, sans-serif');
    expect(vars["--ov-font-weight"]).toBe("500");
    expect([vars["--ov-font-size"], vars["--ov-row-height"], vars["--ov-cell-pad-x"]]).toEqual([
      "14px",
      "24px",
      "8px",
    ]);
    const compact = themeToCssVars({ ...graphite, compact: true, font: "barlow-condensed" });
    expect([
      compact["--ov-font-size"],
      compact["--ov-row-height"],
      compact["--ov-cell-pad-x"],
    ]).toEqual(["12px", "20px", "5px"]);
    expect(compact["--ov-font-family"]).toContain('"Barlow Condensed"');
  });

  it("never carries a locked variable", () => {
    expect(Object.keys(themeToCssVars(graphite)).some((k) => k.includes("locked"))).toBe(false);
  });
});

describe("resolveFunctionalColour and contrastRatio", () => {
  it("resolves", () => {
    expect(resolveFunctionalColour("accent", graphite)).toBe("#ffc400");
    expect(resolveFunctionalColour("#12ab34", graphite)).toBe("#12ab34");
    expect(resolveFunctionalColour("javascript:1", graphite)).toBe("#ffc400");
    expect(resolveFunctionalColour("", graphite)).toBe("#ffc400");
  });

  it("measures known pairs", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("composites alpha over black", () => {
    expect(contrastRatio("#ffffff80", "#000000")).toBeCloseTo(
      contrastRatio("#808080", "#000000"),
      5,
    );
  });
});
