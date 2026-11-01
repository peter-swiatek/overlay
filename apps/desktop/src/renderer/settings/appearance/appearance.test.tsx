import { GRAPHITE, LOCKED_COLOUR_KEYS, LOCKED_COLOURS, THEME_PRESETS } from "@overlay/theme";
import type { Theme, ThemeState } from "@overlay/theme/types";
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
const stateOf = (activeId: string, extra: Theme[] = []): ThemeState => ({
  activeId,
  presets: THEME_PRESETS,
  custom: extra,
});

describe("planThemeEdit", () => {
  it("refuses an edit to a preset and leaves it untouched", () => {
    const state = stateOf("graphite");
    const before = JSON.stringify(state);
    const plan = planThemeEdit(state, { font: "oswald" });
    expect(plan).toEqual({ error: PRESET_LOCKED_MESSAGE });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("edits a custom theme in place and merges tokens", () => {
    const plan = planThemeEdit(stateOf(custom.id, [custom]), {
      compact: true,
      tokens: { accent: "#112233" } as Theme["tokens"],
    });
    if (!("theme" in plan)) throw new Error("expected a theme");
    expect(plan.theme.id).toBe(custom.id);
    expect(plan.theme.compact).toBe(true);
    expect(plan.theme.tokens.accent).toBe("#112233");
    expect(plan.theme.tokens.row).toBe(custom.tokens.row);
  });
});

describe("activeTheme and applyActiveChanged", () => {
  it("falls back to Graphite for an unknown id", () => {
    expect(activeTheme(stateOf("nope")).id).toBe("graphite");
  });

  it("replaces the active custom theme's content", () => {
    const next = applyActiveChanged(stateOf(custom.id, [custom]), { ...custom, compact: true });
    expect(next.custom[0]?.compact).toBe(true);
    expect(applyActiveChanged(stateOf("graphite"), THEME_PRESETS[1]!).activeId).toBe(
      THEME_PRESETS[1]!.id,
    );
  });
});

describe("createThemeWriter", () => {
  function setup(initial: Theme[] = [], active = "graphite") {
    const log: string[] = [];
    let customThemes = initial;
    let activeId = active;
    const snapshot = (): ThemeState => ({ activeId, presets: THEME_PRESETS, custom: customThemes });
    const api = {
      async save(theme: Theme) {
        log.push(`save:${theme.id}:${theme.name}:${theme.font}/${theme.weight}`);
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
    await expect(writer.write(snapshot(), { font: "oswald" })).rejects.toThrow(
      PRESET_LOCKED_MESSAGE,
    );
    await expect(writer.write(snapshot(), { weight: 700 }, { target: "graphite" })).rejects.toThrow(
      PRESET_LOCKED_MESSAGE,
    );
    expect(log).toEqual([]);
  });

  it("serialises and merges edits to a custom theme", async () => {
    const { api, log, snapshot } = setup([custom], custom.id);
    const writer = createThemeWriter(api);
    const stale = snapshot();
    const a = writer.write(stale, { font: "oswald" });
    const b = writer.write(stale, { weight: 600 });
    const c = writer.write(stale, { weight: 700 });
    const [, , last] = await Promise.all([a, b, c]);
    expect(log.filter((l) => l.startsWith("save:"))).toHaveLength(2);
    expect(last.custom).toHaveLength(1);
    expect(last.custom[0]).toMatchObject({ font: "oswald", weight: 700 });
  });

  it("writes to the theme the edit was made on, even after another is selected", async () => {
    const { api, log, snapshot } = setup([custom], custom.id);
    const writer = createThemeWriter(api);
    const pending = writer.write(snapshot(), { font: "manrope" }, { target: custom.id });
    const picked = writer.select("graphite");
    const [afterEdit, afterSelect] = await Promise.all([pending, picked]);
    expect(afterEdit.custom[0]?.font).toBe("manrope");
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
      onEdit={noop}
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

  it("renders each font label in its own family", () => {
    const html = render(stateOf("graphite"));
    for (const [label, family] of [
      ["Inter", "Inter"],
      ["Manrope", "Manrope"],
      ["Oswald", "Oswald"],
      ["Barlow Condensed", "Barlow Condensed"],
    ]) {
      expect(html).toMatch(new RegExp(`font-family:&quot;${family}&quot;[^>]*>${label}<`));
    }
  });

  it("shows the Oswald note only for Oswald", () => {
    const oswald = { ...custom, font: "oswald" as const };
    expect(render(stateOf(oswald.id, [oswald]))).toContain("Oswald has no ExtraBold");
    expect(render(stateOf(custom.id, [custom]))).not.toContain("Oswald has no ExtraBold");
  });

  it("locks the typography controls and offers New theme from this while a preset is active", () => {
    const html = render(stateOf("graphite"));
    expect(html).toContain("Built-in themes can&#x27;t be changed.");
    expect(html).toMatch(/data-variant="primary"[^>]*>New theme from this…</);
    const typo = html.slice(html.indexOf("Overlay font"), html.indexOf("Pills"));
    expect(typo).not.toMatch(/<button(?![^>]*disabled)[^>]*aria-pressed/);
    expect(typo.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(10);
    // The pill switch is not a theme colour and stays editable.
    const pills = html.slice(html.indexOf("Combine safety"));
    expect(pills.slice(0, pills.indexOf("<input") + 200)).not.toContain("disabled");
  });

  it("keeps a custom theme editable and offers a plain New theme button", () => {
    const html = render(stateOf(custom.id, [custom]));
    expect(html).not.toContain("Built-in themes");
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
    const locked = html.slice(html.indexOf("Locked colours"));
    expect(locked).not.toContain("<input");
    expect(locked).toContain("Class colours come from the sim and are locked too.");
  });
});

describe("ThemeScope", () => {
  it("carries theme and locked variables inline without touching the document", () => {
    expect(typeof document).toBe("undefined");
    const html = renderToStaticMarkup(<ThemeScope theme={GRAPHITE}>x</ThemeScope>);
    expect(html).toContain(`--ov-accent:${GRAPHITE.tokens.accent}`);
    expect(html).toContain("--ov-locked-gain:#22c55e");
  });
});
