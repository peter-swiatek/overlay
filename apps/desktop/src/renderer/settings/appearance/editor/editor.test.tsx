import {
  decodeThemeCode,
  GRAPHITE,
  LOCKED_COLOUR_KEYS,
  LOCKED_COLOURS,
  lockedCssVars,
  THEME_PRESETS,
  THEME_TOKEN_KEYS,
} from "@overlay/theme";
import type { Theme, ThemeState } from "@overlay/theme/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { alphaPercentOf, withAlphaPercent, withRgb } from "./alpha";
import { contrastWarnings } from "./contrast";
import { createDebouncer, type Timers } from "./debounce";
import { ThemeEditorEntry } from "./index";
import { LOCKED_LINE, ThemeEditorPanel, TOKEN_LABELS, type EditorApi } from "./ThemeEditor";

const custom: Theme = { ...GRAPHITE, id: "custom-aaaaaaaa", name: "Night Stint" };
const stateOf = (activeId: string, extra: Theme[] = []): ThemeState => ({
  activeId,
  presets: THEME_PRESETS,
  custom: extra,
});

const api: EditorApi = {
  save: vi.fn(),
  setActive: vi.fn(),
  remove: vi.fn(),
  importCode: vi.fn(),
  exportCode: vi.fn(),
  importFile: vi.fn(),
  exportFile: vi.fn(),
};
const render = (state: ThemeState) =>
  renderToStaticMarkup(
    <ThemeEditorPanel state={state} api={api} onState={() => {}} onClose={() => {}} />,
  );

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const timers: Timers = {
    setTimeout: (fn) => {
      pending.set(next, fn);
      return next++;
    },
    clearTimeout: (h) => void pending.delete(h as number),
  };
  return { timers, pending, fire: () => [...pending.values()].forEach((fn) => fn()) };
}

describe("alpha helpers", () => {
  it("maps percent to hex and back", () => {
    expect(withAlphaPercent("#112233", 0)).toBe("#11223300");
    expect(withAlphaPercent("#112233", 50)).toBe("#11223380");
    expect(withAlphaPercent("#11223380", 100)).toBe("#112233");
    expect(alphaPercentOf("#11223380")).toBe(50);
    expect(alphaPercentOf("#112233")).toBe(100);
    expect(alphaPercentOf("#11223300")).toBe(0);
  });
  it("keeps the alpha when only the RGB changes", () => {
    expect(withRgb("#11223380", "#AABBCC")).toBe("#aabbcc80");
    expect(withRgb("#112233", "#aabbcc")).toBe("#aabbcc");
  });
});

describe("debouncer", () => {
  it("runs once with many schedules", () => {
    const f = fakeTimers();
    const run = vi.fn();
    const d = createDebouncer(run, 400, f.timers);
    for (let i = 0; i < 10; i++) d.schedule();
    expect(f.pending.size).toBe(1);
    f.fire();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("flush runs a pending call now and only once", () => {
    const f = fakeTimers();
    const run = vi.fn();
    const d = createDebouncer(run, 400, f.timers);
    d.flush();
    expect(run).not.toHaveBeenCalled();
    d.schedule();
    d.flush();
    d.flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(0);
  });
});

describe("contrastWarnings", () => {
  it("reports what the Graphite preset really gives", () => {
    const w = contrastWarnings(GRAPHITE.tokens);
    expect(w.every((x) => x.ratio < x.needed)).toBe(true);
    expect(w).toEqual([]);
  });
  it("warns for every failing pair on a crafted theme", () => {
    const tokens = {
      ...GRAPHITE.tokens,
      backgroundTint: "#000000",
      row: "#808080",
      rowAlt: "#808080",
      header: "#808080",
      ownRow: "#808080",
      text: "#909090",
      textMuted: "#888888",
    };
    const w = contrastWarnings(tokens);
    expect(w.map((x) => `${x.token}/${x.against}`)).toEqual([
      "text/row",
      "text/rowAlt",
      "text/header",
      "textMuted/row",
      "textMuted/header",
      "text/ownRow",
    ]);
    expect(w[5]!.message).toMatch(/^Text on the own row is \d\.\d:1; aim for at least 4\.5:1\.$/);
  });
  it("composites transparent rows over the tint", () => {
    const tokens = {
      ...GRAPHITE.tokens,
      backgroundTint: "#ffffff",
      row: "#ffffff00",
      text: "#ffffff",
    };
    const w = contrastWarnings(tokens);
    expect(w.some((x) => x.against === "row" && x.token === "text")).toBe(true);
    const dark = contrastWarnings({ ...tokens, backgroundTint: "#000000" });
    expect(dark.some((x) => x.against === "row" && x.token === "text")).toBe(false);
  });
});

describe("locked colours cannot be imported", () => {
  const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const crafted = `OVT1.${b64url(
    JSON.stringify({
      name: "Sneaky",
      gain: "#000000",
      loss: "#000001",
      licenceA: "#000002",
      flagBlue: "#000003",
      tokens: { ...GRAPHITE.tokens, gain: "#111111", flagBlue: "#222222" },
      locked: { gain: "#333333", fastest: "#444444" },
      font: "inter",
      weight: 600,
      compact: false,
    }),
  )}`;

  it("decodes to exactly the theme tokens and leaves the locked colours alone", () => {
    const lockedBefore = JSON.stringify(LOCKED_COLOURS);
    const varsBefore = JSON.stringify(lockedCssVars());
    const result = decodeThemeCode(crafted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.theme.tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
    expect(Object.keys(result.theme).sort()).toEqual(
      ["compact", "font", "id", "name", "tokens", "weight"].sort(),
    );
    expect(JSON.stringify(LOCKED_COLOURS)).toBe(lockedBefore);
    expect(JSON.stringify(lockedCssVars())).toBe(varsBefore);

    const html = render(stateOf(result.theme.id, [result.theme]));
    const labels = [...html.matchAll(/<input[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]!);
    for (const key of LOCKED_COLOUR_KEYS) {
      expect(labels.some((l) => l.toLowerCase().includes(key.toLowerCase()))).toBe(false);
    }
    expect(labels.filter((l) => l.endsWith("(hex)"))).toHaveLength(THEME_TOKEN_KEYS.length);
  });
});

describe("editor render", () => {
  it("shows every token row, the locked line and the preview", () => {
    const html = render(stateOf(custom.id, [custom]));
    for (const key of THEME_TOKEN_KEYS) {
      expect(html).toContain(`data-token="${key}"`);
      expect(html).toContain(`>${TOKEN_LABELS[key]}</span>`);
    }
    expect(html).toContain(LOCKED_LINE);
    for (const name of ["Max Example", "José María Pérez", "Zofia Świątkowska", "Ana Example"]) {
      expect(html).toContain(name);
    }
    expect(html).toContain(`--ov-accent:${custom.tokens.accent}`);
    expect(html).toContain("--ov-locked-gain");
    expect(html).toContain("var(--ov-locked-fastest)");
  });

  it("uses the draft theme's accent in the preview", () => {
    const themed = { ...custom, tokens: { ...custom.tokens, accent: "#ff00aa" } };
    expect(render(stateOf(themed.id, [themed]))).toContain("--ov-accent:#ff00aa");
  });

  it("locks colours, rename and delete and shows the note for a preset", () => {
    const html = render(stateOf("graphite"));
    expect(html).toContain("Built-in themes can&#x27;t be changed.");
    expect(html).not.toContain("first edit makes a custom copy");
    expect(html).toMatch(/<input[^>]*aria-label="Theme name"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*data-variant="danger"[^>]*disabled=""[^>]*>Delete/);
    const tokens = html.slice(html.indexOf('class="ed-tokens"'), html.indexOf("ed-manage"));
    const inputs = tokens.match(/<input[^>]*>/g)!;
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.includes("disabled"))).toBe(true);
  });

  it("enables colours, rename and delete and hides the note for a custom theme", () => {
    const html = render(stateOf(custom.id, [custom]));
    expect(html).not.toContain("Built-in themes");
    expect(html).not.toMatch(/aria-label="Theme name"[^>]*disabled/);
    expect(html).not.toMatch(/data-variant="danger"[^>]*disabled/);
    const tokens = html.slice(html.indexOf('class="ed-tokens"'), html.indexOf("ed-manage"));
    expect(tokens).not.toContain("disabled");
  });

  it("shows a warning next to Text", () => {
    const bad = { ...custom, tokens: { ...custom.tokens, text: "#303030" } };
    const html = render(stateOf(bad.id, [bad]));
    const row = html.split('data-token="text"')[1]!.split('data-token="textMuted"')[0]!;
    expect(row).toContain("ed-warn");
    expect(row).toContain("Text on the row is");
  });

  it("renders only a button until opened and never touches the document root", () => {
    const doc = { documentElement: {} };
    vi.stubGlobal("document", doc);
    const html = renderToStaticMarkup(
      <ThemeEditorEntry state={stateOf("graphite")} onState={() => {}} />,
    );
    render(stateOf("graphite"));
    vi.unstubAllGlobals();
    expect(html).toContain("Edit colours");
    expect(html).not.toContain("Built-in themes");
    expect(doc.documentElement).toEqual({});
  });
});
