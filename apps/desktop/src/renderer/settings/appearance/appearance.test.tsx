import { GRAPHITE, LOCKED_COLOUR_KEYS, LOCKED_COLOURS, THEME_PRESETS } from "@overlay/theme";
import type { Theme, ThemeState } from "@overlay/theme/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceForm } from "../pages/AppearancePage";
import { ThemeScope } from "./ThemeScope";
import { activeTheme, applyActiveChanged, createThemeWriter, planThemeEdit } from "./model";

const custom: Theme = { ...GRAPHITE, id: "custom-aaaaaaaa", name: "Night Stint" };
const stateOf = (activeId: string, extra: Theme[] = []): ThemeState => ({
  activeId,
  presets: THEME_PRESETS,
  custom: extra,
});
const seq = () => {
  let n = 0;
  return () => (n += 0.137) % 1;
};

describe("planThemeEdit", () => {
  it("forks a preset and leaves the preset untouched", () => {
    const state = stateOf("graphite");
    const before = JSON.stringify(state.presets);
    const plan = planThemeEdit(state, { font: "oswald" }, seq());
    expect(plan.activate).toBe(true);
    expect(plan.theme.id).toMatch(/^custom-/);
    expect(plan.theme.name).toContain("(custom)");
    expect(plan.theme.font).toBe("oswald");
    expect(plan.theme.tokens).toEqual(GRAPHITE.tokens);
    expect(JSON.stringify(state.presets)).toBe(before);
  });

  it("edits a custom theme in place and merges tokens", () => {
    const plan = planThemeEdit(stateOf(custom.id, [custom]), {
      compact: true,
      tokens: { accent: "#112233" } as Theme["tokens"],
    });
    expect(plan.activate).toBe(false);
    expect(plan.theme.id).toBe(custom.id);
    expect(plan.theme.compact).toBe(true);
    expect(plan.theme.tokens.accent).toBe("#112233");
    expect(plan.theme.tokens.row).toBe(custom.tokens.row);
  });

  it("edits the fork, not a second fork, after activation", () => {
    const first = planThemeEdit(stateOf("graphite"), { weight: 700 }, seq());
    const next = stateOf(first.theme.id, [first.theme]);
    const second = planThemeEdit(next, { compact: true });
    expect(second.activate).toBe(false);
    expect(second.theme.id).toBe(first.theme.id);
    expect(second.theme.weight).toBe(700);
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
  function fakeApi() {
    const log: string[] = [];
    let customThemes: Theme[] = [];
    let activeId = "graphite";
    const snapshot = (): ThemeState => ({
      activeId,
      presets: THEME_PRESETS,
      custom: customThemes,
    });
    return {
      log,
      api: {
        async save(theme: Theme) {
          log.push(`save:${theme.id}:${theme.font}/${theme.weight}`);
          await Promise.resolve();
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
      },
      snapshot,
    };
  }

  it("saves then activates a fork", async () => {
    const { api, log, snapshot } = fakeApi();
    const next = await createThemeWriter(api).write(snapshot(), { font: "manrope" });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatch(/^save:custom-/);
    expect(log[1]).toMatch(/^active:custom-/);
    expect(next.activeId).toMatch(/^custom-/);
  });

  it("serialises calls and merges edits that arrive in flight, one fork only", async () => {
    const { api, log, snapshot } = fakeApi();
    const writer = createThemeWriter(api);
    const stale = snapshot();
    const a = writer.write(stale, { font: "oswald" });
    const b = writer.write(stale, { weight: 600 });
    const c = writer.write(stale, { weight: 700 });
    const [, , last] = await Promise.all([a, b, c]);
    expect(log.filter((l) => l.startsWith("active:"))).toHaveLength(1);
    expect(log.filter((l) => l.startsWith("save:"))).toHaveLength(2);
    expect(last.custom).toHaveLength(1);
    expect(last.custom[0]).toMatchObject({ font: "oswald", weight: 700 });
  });
});

describe("createThemeWriter targets and select", () => {
  function setup(failActivate = false) {
    const log: string[] = [];
    let customThemes: Theme[] = [];
    let activeId = "graphite";
    let failNext = failActivate;
    const snapshot = (): ThemeState => ({ activeId, presets: THEME_PRESETS, custom: customThemes });
    const api = {
      async save(theme: Theme) {
        log.push(`save:${theme.id}:${theme.font}`);
        await Promise.resolve();
        customThemes = customThemes.some((t) => t.id === theme.id)
          ? customThemes.map((t) => (t.id === theme.id ? theme : t))
          : [...customThemes, theme];
        return snapshot();
      },
      async setActive(id: string) {
        log.push(`active:${id}`);
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        activeId = id;
        return snapshot();
      },
      async getState() {
        return snapshot();
      },
    };
    return { api, log, snapshot };
  }

  it("writes an edit to the theme it was made on, even after another theme is selected", async () => {
    const { api, log, snapshot } = setup();
    const writer = createThemeWriter(api);
    const first = await writer.write(snapshot(), { font: "oswald" }, { target: "graphite" });
    const forkId = first.activeId;
    expect(forkId).toMatch(/^custom-/);
    // A draft made on the fork is pending while the user picks Graphite from the gallery.
    const pending = writer.write(first, { font: "manrope" }, { target: forkId });
    const picked = writer.select("graphite");
    const [afterEdit, afterSelect] = await Promise.all([pending, picked]);
    expect(afterEdit.custom.find((t) => t.id === forkId)?.font).toBe("manrope");
    expect(afterSelect.activeId).toBe("graphite");
    expect(afterSelect.custom).toHaveLength(1);
    expect(log.at(-1)).toBe("active:graphite");
  });

  it("does not fork a second time after a failed activation", async () => {
    const { api, snapshot } = setup(true);
    const writer = createThemeWriter(api);
    await expect(
      writer.write(snapshot(), { font: "oswald" }, { target: "graphite" }),
    ).rejects.toThrow("disk full");
    const retry = await writer.write(snapshot(), { weight: 700 }, { target: "graphite" });
    expect(retry.custom).toHaveLength(1);
    expect(retry.activeId).toBe(retry.custom[0]!.id);
    expect(retry.custom[0]).toMatchObject({ font: "oswald" });
  });

  it("can save a fork without activating it", async () => {
    const { api, snapshot } = setup();
    const next = await createThemeWriter(api).write(
      snapshot(),
      { font: "oswald" },
      { target: "graphite", activate: false },
    );
    expect(next.activeId).toBe("graphite");
    expect(next.custom).toHaveLength(1);
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

  it("shows the preset note only while a preset is active", () => {
    expect(render(stateOf("graphite"))).toContain("Presets never change");
    expect(render(stateOf(custom.id, [custom]))).not.toContain("Presets never change");
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
