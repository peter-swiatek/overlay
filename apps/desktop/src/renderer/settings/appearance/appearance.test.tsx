import {
  DEFAULT_TYPOGRAPHY,
  GRAPHITE,
  LOCKED_COLOUR_KEYS,
  LOCKED_COLOURS,
  THEME_FONTS,
  THEME_PRESETS,
} from "@overlay/theme";
import type { Theme, ThemeState, Typography } from "@overlay/theme/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceForm } from "../pages/AppearancePage";
import { ThemeScope } from "./ThemeScope";
import {
  activeTheme,
  applyActiveChanged,
  createThemeWriter,
  PRESET_LOCKED_MESSAGE,
  planThemeEdit,
} from "./model";

const custom: Theme = { ...GRAPHITE, id: "custom-aaaaaaaa", name: "Night Stint" };
const accent = (hex: string) => ({ accent: hex }) as Theme["tokens"];
const stateOf = (
  activeId: string,
  extra: Theme[] = [],
  typography: Typography = DEFAULT_TYPOGRAPHY,
): ThemeState => ({
  activeId,
  presets: THEME_PRESETS,
  custom: extra,
  typography,
});

describe("planThemeEdit", () => {
  it("refuses an edit to a preset and leaves it untouched", () => {
    const state = stateOf("graphite");
    const before = JSON.stringify(state);
    const plan = planThemeEdit(state, { name: "Mine" });
    expect(plan).toEqual({ error: PRESET_LOCKED_MESSAGE });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("edits a custom theme in place and merges tokens", () => {
    const plan = planThemeEdit(stateOf(custom.id, [custom]), {
      name: "Renamed",
      tokens: { accent: "#112233" } as Theme["tokens"],
    });
    if (!("theme" in plan)) throw new Error("expected a theme");
    expect(plan.theme.id).toBe(custom.id);
    expect(plan.theme.name).toBe("Renamed");
    expect(plan.theme.tokens.accent).toBe("#112233");
    expect(plan.theme.tokens.row).toBe(custom.tokens.row);
  });
});

describe("activeTheme and applyActiveChanged", () => {
  it("falls back to Graphite for an unknown id", () => {
    expect(activeTheme(stateOf("nope")).id).toBe("graphite");
  });

  it("replaces the active custom theme's content and the typography", () => {
    const typography: Typography = { font: "oswald", weight: 700, compact: true };
    const next = applyActiveChanged(stateOf(custom.id, [custom]), {
      theme: { ...custom, name: "Renamed" },
      typography,
    });
    expect(next.custom[0]?.name).toBe("Renamed");
    expect(next.typography).toEqual(typography);
    const picked = applyActiveChanged(stateOf("graphite", [], typography), {
      theme: THEME_PRESETS[1]!,
      typography,
    });
    expect(picked.activeId).toBe(THEME_PRESETS[1]!.id);
    expect(picked.typography).toEqual(typography);
  });
});

describe("createThemeWriter", () => {
  function setup(initial: Theme[] = [], active = "graphite") {
    const log: string[] = [];
    let customThemes = initial;
    let activeId = active;
    const snapshot = (): ThemeState => ({
      activeId,
      presets: THEME_PRESETS,
      custom: customThemes,
      typography: DEFAULT_TYPOGRAPHY,
    });
    const api = {
      async save(theme: Theme) {
        log.push(`save:${theme.id}:${theme.name}:${theme.tokens.accent}`);
        await Promise.resolve();
        if (!customThemes.some((t) => t.id === theme.id) && customThemes.length >= 50) {
          throw new Error("You can keep up to 50 custom themes");
        }
        customThemes = customThemes.some((t) => t.id === theme.id)
          ? customThemes.map((t) => (t.id === theme.id ? theme : t))
          : [...customThemes, theme];
        return snapshot();
      },
      async setActive(id: string) {
        log.push(`active:${id}`);
        activeId = id;
        return snapshot();
      },
      async getState() {
        return snapshot();
      },
    };
    return { api, log, snapshot };
  }

  it("refuses to write to a preset and saves nothing", async () => {
    const { api, log, snapshot } = setup();
    const writer = createThemeWriter(api);
    await expect(writer.write(snapshot(), { name: "Mine" })).rejects.toThrow(PRESET_LOCKED_MESSAGE);
    await expect(
      writer.write(snapshot(), { tokens: accent("#112233") }, { target: "graphite" }),
    ).rejects.toThrow(PRESET_LOCKED_MESSAGE);
    expect(log).toEqual([]);
  });

  it("serialises and merges edits to a custom theme", async () => {
    const { api, log, snapshot } = setup([custom], custom.id);
    const writer = createThemeWriter(api);
    const stale = snapshot();
    const a = writer.write(stale, { name: "Renamed" });
    const b = writer.write(stale, { tokens: accent("#111111") });
    const c = writer.write(stale, { tokens: accent("#222222") });
    const [, , last] = await Promise.all([a, b, c]);
    expect(log.filter((l) => l.startsWith("save:"))).toHaveLength(2);
    expect(last.custom).toHaveLength(1);
    expect(last.custom[0]).toMatchObject({ name: "Renamed", tokens: { accent: "#222222" } });
  });

  it("writes to the theme the edit was made on, even after another is selected", async () => {
    const { api, log, snapshot } = setup([custom], custom.id);
    const writer = createThemeWriter(api);
    const pending = writer.write(snapshot(), { tokens: accent("#123456") }, { target: custom.id });
    const picked = writer.select("graphite");
    const [afterEdit, afterSelect] = await Promise.all([pending, picked]);
    expect(afterEdit.custom[0]?.tokens.accent).toBe("#123456");
    expect(afterSelect.activeId).toBe("graphite");
    expect(log.at(-1)).toBe("active:graphite");
  });

  it("creates a named copy of the active preset and activates it", async () => {
    const { api, log, snapshot } = setup();
    const next = await createThemeWriter(api).create(snapshot(), "  My Stint  ");
    expect(log[0]).toMatch(/^save:custom-[^:]+:My Stint:/);
    expect(log[1]).toMatch(/^active:custom-/);
    expect(next.activeId).toMatch(/^custom-/);
    expect(next.custom[0]).toMatchObject({ name: "My Stint", tokens: GRAPHITE.tokens });
    expect(next.presets).toEqual(THEME_PRESETS);
  });

  it("surfaces the cap error from main when creating the 51st theme", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      ...GRAPHITE,
      id: `custom-${String(i).padStart(8, "0")}`,
      name: `T${i}`,
    }));
    const { api, snapshot } = setup(many);
    await expect(createThemeWriter(api).create(snapshot(), "One more")).rejects.toThrow("up to 50");
  });
});

const noop = () => undefined;
function render(state: ThemeState, combinePills = false): string {
  return renderToStaticMarkup(
    <AppearanceForm
      state={state}
      combinePills={combinePills}
      error={null}
      onSelect={noop}
      onTypography={noop}
      onCreate={noop}
      onCombinePills={noop}
      onState={noop}
    />,
  );
}

describe("AppearanceForm", () => {
  it("lists the presets then custom themes and marks the active one", () => {
    const html = render(stateOf(custom.id, [custom]));
    const names = [...THEME_PRESETS.map((t) => t.name), "Night Stint"];
    const positions = names.map((n) => html.indexOf(`ap-card-name">${n}<`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(
      html.match(
        /aria-pressed="true"[^>]*class="ap-card"|class="ap-card"[^>]*aria-pressed="true"/g,
      ),
    ).toHaveLength(1);
    expect(html.match(/ap-active/g)).toHaveLength(1);
    expect(html).toContain("Custom");
    expect(html).toContain("Max Example");
  });

  it("renders every font in the closed picker's list, each name in its own family", () => {
    const html = render(stateOf("graphite"));
    const list = html.slice(html.indexOf('role="listbox"'), html.indexOf("</ul>"));
    expect(list.match(/role="option"/g)).toHaveLength(THEME_FONTS.length);
    for (const [label, family] of [
      ["Inter", "Inter"],
      ["Manrope", "Manrope"],
      ["Oswald", "Oswald"],
      ["Barlow Condensed", "Barlow Condensed"],
      ["DM Sans", "DM Sans"],
      ["Figtree", "Figtree"],
      ["Urbanist", "Urbanist"],
    ]) {
      expect(list).toMatch(
        new RegExp(
          `font-family:&quot;${family}&quot;[^>]*>(<span[^>]*>[^<]*</span>)?<span class="ap-font-name">${label}<`,
        ),
      );
    }
    // Closed: the list is in the markup but hidden, and nothing is highlighted for a reader.
    expect(html).toMatch(/role="listbox"[^>]*hidden=""/);
    expect(html).toMatch(/role="combobox"[^>]*aria-expanded="false"/);
    expect(html).not.toContain("aria-activedescendant");
  });

  it("no longer uses segmented buttons for the font", () => {
    const typo = typographyOf(render(stateOf("graphite")));
    expect(typo).not.toMatch(/aria-pressed="[a-z]+"[^>]*>(Inter|Manrope|Oswald|Barlow Condensed)</);
  });

  it("shows the Oswald note only for Oswald", () => {
    const oswald = { ...DEFAULT_TYPOGRAPHY, font: "oswald" as const };
    expect(render(stateOf("graphite", [], oswald))).toContain("Oswald has no ExtraBold");
    expect(render(stateOf("graphite"))).not.toContain("Oswald has no ExtraBold");
  });

  const typographyOf = (html: string) =>
    html.slice(html.indexOf(">Typography<"), html.indexOf(">Pills<"));

  it("keeps the typography controls enabled with every built-in theme active", () => {
    for (const preset of THEME_PRESETS) {
      const typo = typographyOf(render(stateOf(preset.id)));
      expect(typo).toContain("Overlay font");
      expect(typo).toContain("Compact mode");
      expect(typo).not.toContain("disabled");
      expect(typo).not.toContain("can&#x27;t be changed");
    }
  });

  it("shows the global typography, not anything from the theme", () => {
    const typography: Typography = { font: "manrope", weight: 700, compact: true };
    const typo = typographyOf(render(stateOf("carbon", [], typography)));
    expect(typo).toMatch(
      /role="combobox"[^>]*font-family:&quot;Manrope&quot;[^>]*><span class="ap-font-value">Manrope</,
    );
    expect(typo.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(typo).toMatch(/aria-selected="true"[^>]*data-font="manrope"/);
    expect(typo).toMatch(
      /<input[^>]*checked=""[^>]*aria-label="Compact mode"|aria-label="Compact mode"[^>]*checked=""/,
    );
  });

  it("does not change the typography section when the theme changes", () => {
    const typography: Typography = { font: "oswald", weight: 600, compact: true };
    const sections = [...THEME_PRESETS.map((t) => t.id), custom.id].map((id) =>
      typographyOf(render(stateOf(id, [custom], typography))),
    );
    for (const s of sections) expect(s).toBe(sections[0]);
  });

  it("locks only the colours while a preset is active and offers New theme from this", () => {
    const html = render(stateOf("graphite"));
    expect(html).toContain("Built-in colour schemes can&#x27;t be changed.");
    expect(html).toMatch(/data-variant="primary"[^>]*>New theme from this…</);
    // The pill switch is not a theme colour and stays editable.
    const pills = html.slice(html.indexOf("Combine safety"));
    expect(pills.slice(0, pills.indexOf("<input") + 200)).not.toContain("disabled");
  });

  it("keeps a custom theme editable and offers a plain New theme button", () => {
    const html = render(stateOf(custom.id, [custom]));
    expect(html).not.toContain("Built-in colour schemes");
    expect(html).toContain(">New theme<");
    expect(html).not.toContain("New theme from this");
    const typo = html.slice(html.indexOf("Overlay font"), html.indexOf("Pills"));
    expect(typo).not.toContain("disabled");
  });

  it("lists all locked colours with their hex values and no input", () => {
    const html = render(stateOf("graphite"));
    expect(html.match(/data-key="/g)).toHaveLength(LOCKED_COLOUR_KEYS.length);
    for (const key of LOCKED_COLOUR_KEYS) {
      expect(html).toContain(`data-key="${key}"`);
      expect(html).toContain(`<code>${LOCKED_COLOURS[key]}</code>`);
    }
    expect(html).toContain("Driving aids");
    expect(html).toContain("Shift light");
    expect(html).toContain("<code>#38bdf8</code>");
    const locked = html.slice(html.indexOf("Locked colours"));
    expect(locked).not.toContain("<input");
    expect(locked).toContain("Class colours come from the sim and are locked too.");
  });
});

describe("ThemeScope", () => {
  it("carries theme and locked variables inline without touching the document", () => {
    expect(typeof document).toBe("undefined");
    const typography: Typography = { font: "oswald", weight: 700, compact: true };
    const html = renderToStaticMarkup(
      <ThemeScope theme={GRAPHITE} typography={typography}>
        x
      </ThemeScope>,
    );
    expect(html).toContain(`--ov-accent:${GRAPHITE.tokens.accent}`);
    expect(html).toContain("--ov-font-weight:700");
    expect(html).toContain("--ov-font-size:12px");
    expect(html).toContain("Oswald");
    expect(html).toContain("--ov-locked-gain:#22c55e");
  });
});
