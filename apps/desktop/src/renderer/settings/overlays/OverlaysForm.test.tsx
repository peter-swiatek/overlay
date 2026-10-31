import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import type { SimName } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlaysForm } from "./OverlaysForm";
import { testManifest, testTableManifest } from "./test-manifest";

const noop = () => undefined;

function render(opts: {
  manifests?: OverlayManifest[];
  patch?: Partial<OverlayInstanceSettings>;
  sim?: SimName;
  dev?: boolean;
  selected?: string;
  units?: "metric" | "imperial";
}): string {
  const manifests = opts.manifests ?? [testManifest];
  const all: Record<string, OverlayInstanceSettings> = {};
  for (const m of manifests) all[m.id] = { ...defaultInstanceSettings(m), ...opts.patch };
  return renderToStaticMarkup(
    <OverlaysForm
      manifests={manifests}
      all={all}
      developerEnabled={opts.dev ?? false}
      selectedId={opts.selected ?? manifests[0]?.id ?? null}
      sim={opts.sim ?? "lmu"}
      prefs={{ ...DEFAULT_DISPLAY_PREFS, units: opts.units ?? "metric" }}
      onSelect={noop}
      onToggle={noop}
      onSim={noop}
      send={noop}
      onReset={noop}
    />,
  );
}

describe("OverlaysForm lists", () => {
  it("shows active and available lists with Enable toggles", () => {
    const off: OverlayManifest = {
      ...testManifest,
      id: "off",
      title: "Quiet One",
      defaultEnabled: false,
    };
    const html = render({ manifests: [testManifest, off] });
    expect(html).toContain("Active overlays");
    expect(html).toContain("Available overlays");
    expect(html).toContain('aria-label="Enable Test Panel"');
    expect(html).toContain('aria-label="Enable Quiet One"');
    expect(html.indexOf("Test Panel")).toBeLessThan(html.indexOf("Available overlays"));
  });

  it("hides developer overlays unless developer tools are on", () => {
    const dev: OverlayManifest = { ...testManifest, id: "dev", title: "Dev Only", dev: true };
    expect(render({ manifests: [testManifest, dev] })).not.toContain("Dev Only");
    expect(render({ manifests: [testManifest, dev], dev: true })).toContain("Dev Only");
  });

  it("greys an overlay that does not support the filtered sim", () => {
    const lmuOnly: OverlayManifest = {
      ...testManifest,
      id: "l",
      title: "Lmu Thing",
      sims: ["lmu"],
    };
    expect(render({ manifests: [lmuOnly], sim: "iracing" })).toContain("LMU only");
  });
});

describe("generated panel", () => {
  it("renders every control kind with its label and value", () => {
    const html = render({});
    for (const text of [
      "Bar size",
      "Mode choice",
      "Tint colour",
      "Flash on change",
      "Extra items",
      "Gap distance",
      ">Layout<",
      ">Colours<",
      ">Options<",
      "Blink briefly.",
      "Appearance",
      "Hidden",
      "Always show",
      "Reset to defaults",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('role="switch"');
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('type="range"');
    expect(html).toContain('type="color"');
    expect(html).toContain("<option");
    expect(html).toContain('value="20"');
  });

  it("shows Theme accent for the accent colour and the hex otherwise", () => {
    expect(render({})).toContain("Theme accent");
    expect(render({})).toContain("Use theme accent");
    const base = defaultInstanceSettings(testManifest);
    const html = render({ patch: { options: { ...base.options, tint: "#12ab34" } } });
    expect(html).not.toContain(">Theme accent<");
    expect(html).toContain("#12ab34");
  });

  it("shows Pick up to N and disables Add at the limit", () => {
    expect(render({})).toContain("Pick up to 2");
    const base = defaultInstanceSettings(testManifest);
    const full = render({ patch: { options: { ...base.options, extras: ["x", "y"] } } });
    expect(full).toMatch(/<select[^>]*aria-label="Add Extra items"[^>]*disabled/);
    expect(render({})).not.toMatch(/<select[^>]*aria-label="Add Extra items"[^>]*disabled/);
  });

  it("disables LMU-only fields, settings and options with a badge when filtered to iRacing", () => {
    const ir = render({ sim: "iracing" });
    expect(ir).toContain("LMU only");
    expect(ir).toMatch(/<option value="fancy"[^>]*disabled/);
    expect(ir).toMatch(/aria-disabled="true"/);
    const lmu = render({ sim: "lmu" });
    expect(lmu).not.toContain("LMU only");
  });

  it("lets a sim-excluded control be switched off but not on", () => {
    const base = defaultInstanceSettings(testManifest);
    const withD = (visible: boolean) =>
      render({
        sim: "iracing",
        patch: {
          common: {
            ...base.common,
            fields: base.common.fields.map((f) => (f.id === "d" ? { ...f, visible } : f)),
          },
        },
      });
    expect(withD(true)).not.toMatch(/aria-label="Show Delta stint"[^>]*disabled/);
    expect(withD(false)).toMatch(/aria-label="Show Delta stint"[^>]*disabled/);
  });

  it("converts metres to feet for imperial units", () => {
    expect(render({ units: "metric" })).toContain('aria-valuenow="50"');
    const imp = render({ units: "imperial" });
    expect(imp).toContain('aria-valuenow="164"');
    expect(imp).toContain(">ft<");
  });
});

describe("fields and columns", () => {
  it("lists fields with toggles for a non-table overlay, without table-only rows", () => {
    const html = render({});
    expect(html).toContain(">Fields<");
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Row opacity");
    expect(html).not.toContain("Move up");
    expect(html).not.toContain("Widths apply");
  });

  it("adds Row opacity and a Columns list with widths and move buttons for a table", () => {
    const html = render({ manifests: [testTableManifest] });
    expect(html).toContain("Row opacity");
    expect(html).toContain(">Columns<");
    expect(html).toContain('aria-label="Move up Alpha"');
    expect(html).toContain('aria-label="Move down Delta stint"');
    expect(html).toMatch(/aria-label="Move up Alpha"[^>]*disabled/);
    expect(html).toContain('aria-label="Width of Bravo"');
    expect(html).toContain("Default");
    expect(html).toContain("Widths apply when Column width is Custom.");
    // Bravo has its own default width; Alpha falls back to 10.
    expect(html).toMatch(/aria-label="Width of Bravo"[^>]*value="25"/);
    expect(html).toMatch(/aria-label="Width of Alpha"[^>]*value="10"/);
  });

  it("omits the Fields section when the manifest has none", () => {
    const html = render({ manifests: [{ ...testManifest, fields: [] }] });
    expect(html).not.toContain(">Fields<");
  });
});
