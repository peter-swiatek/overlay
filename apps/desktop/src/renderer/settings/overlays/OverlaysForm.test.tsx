import type {
  OverlayInstanceSettings,
  OverlayManifest,
  SettingField,
} from "@overlay/overlays/contract";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import type { SimName } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldPicker, parsePickDrag, pickDragType } from "./FieldPicker";
import { OverlayPanel, SettingRow } from "./OverlayPanel";
import { OverlaysForm } from "./OverlaysForm";
import { testManifest, testTableManifest } from "./test-manifest";

const noop = () => undefined;

function render(opts: {
  manifests?: OverlayManifest[];
  patch?: Partial<OverlayInstanceSettings>;
  sim?: SimName | null;
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
      sim={opts.sim === undefined ? "lmu" : opts.sim}
      sizes={{}}
      prefs={{ ...DEFAULT_DISPLAY_PREFS, units: opts.units ?? "metric" }}
      onSelect={noop}
      onToggle={noop}
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
      "Visibility",
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

  it("shows the picker counter and disables unticked boxes at the limit", () => {
    expect(render({})).toContain("1 of 2");
    expect(render({})).not.toMatch(/<input[^>]*aria-label="Why"[^>]*disabled/);
    const base = defaultInstanceSettings(testManifest);
    const full = render({ patch: { options: { ...base.options, extras: ["x", "y"] } } });
    expect(full).toContain("2 of 2");
    expect(full).toMatch(/<input[^>]*aria-label="Zed"[^>]*disabled/);
    expect(full).not.toMatch(/<input[^>]*aria-label="Why"[^>]*disabled/);
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

  it("shows the total note instead of the legacy note once the width mode is known", () => {
    const html = render({
      manifests: [testTableManifest],
      patch: { options: { "column-width": "auto" } },
    });
    expect(html).not.toContain("Widths apply");
    expect(html).toContain("Narrowest readable width is marked on each slider.");
  });

  it("omits the Fields section when the manifest has none", () => {
    const html = render({ manifests: [{ ...testManifest, fields: [] }] });
    expect(html).not.toContain(">Fields<");
  });
});

describe("page layout and sections", () => {
  it("renders the list, the settings and the preview panes", () => {
    const html = render({});
    expect(html).toContain('class="ov-left"');
    expect(html).toContain('class="ov-right"');
    expect(html).toContain('<aside class="ov-preview" aria-label="Preview">');
    expect(html).not.toContain("Sim filter");
  });

  it("greys nothing when no sim is known, and follows the game otherwise", () => {
    const lmuOnly: OverlayManifest = {
      ...testManifest,
      id: "l",
      title: "Lmu Thing",
      sims: ["lmu"],
    };
    expect(render({ manifests: [lmuOnly], sim: null })).not.toContain("LMU only");
    expect(render({ sim: null })).not.toContain("LMU only");
    expect(render({ manifests: [lmuOnly], sim: "iracing" })).toContain("LMU only");
    expect(render({ manifests: [lmuOnly], sim: "lmu" })).not.toContain("LMU only");
  });

  it("orders the sections as the plan says", () => {
    const manifest = OVERLAY_MANIFESTS.find((m) => m.id === "leaderboard");
    if (!manifest) throw new Error("no leaderboard manifest");
    const html = render({ manifests: [manifest] });
    const order = [
      ">Appearance<",
      ">Visibility<",
      ">Columns<",
      ">Header and footer<",
      ">Layout<",
      "Reset to defaults",
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("puts every multi setting in Header and footer, not in its manifest section", () => {
    const html = render({});
    expect(html).toContain(">Header and footer<");
    expect(html.indexOf(">Header and footer<")).toBeLessThan(html.indexOf(">Layout<"));
  });
});

type El = ReactElement<Record<string, unknown>>;

/** Every element below `root` that matches, without expanding components. */
function findAll(root: ReactElement, match: (el: El) => boolean): El[] {
  const out: El[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null || !("props" in node)) return;
    const el = node as El;
    if (match(el)) out.push(el);
    visit(el.props.children);
  };
  visit(root);
  return out;
}

describe("segmented selects", () => {
  const fuel = OVERLAY_MANIFESTS.find((m) => m.id === "fuel");
  const layout = fuel?.settings.find((f) => f.key === "layout");

  it("renders a two-option select as a segmented control", () => {
    if (!fuel) throw new Error("no fuel manifest");
    const html = render({ manifests: [fuel] });
    expect(html).toContain('aria-label="Layout" class="ctl-segmented"');
    expect(html).toContain(">Horizontal<");
    expect(html).not.toMatch(/<select[^>]*aria-label="Layout"/);
  });

  it("switches Fuel Layout with one click and sends the option patch", () => {
    if (layout?.kind !== "select") throw new Error("no fuel layout setting");
    const sent: unknown[] = [];
    const row = SettingRow({
      field: layout,
      value: "vertical",
      sim: null,
      prefs: DEFAULT_DISPLAY_PREFS,
      onChange: (value) => sent.push({ options: { [layout.key]: value } }),
    });
    const control = (row.props as { children: ReactElement }).children;
    const expand = (el: ReactElement): ReactElement =>
      (el.type as (p: unknown) => ReactElement)(el.props);
    const segmented = expand(expand(control));
    const buttons = findAll(segmented, (el) => el.type === "button");
    expect(buttons.map((b) => b.props.children)).toEqual(["Vertical", "Horizontal"]);
    (buttons[1]?.props as { onClick(): void }).onClick();
    expect(sent).toEqual([{ options: { layout: "horizontal" } }]);
  });

  it("keeps a dropdown for a select with a sim-limited option", () => {
    expect(render({})).toMatch(/<select[^>]*aria-label="Mode choice"/);
  });
});

describe("FieldPicker", () => {
  const field: Extract<SettingField, { kind: "multi" }> = {
    key: "k",
    label: "Header fields",
    kind: "multi",
    default: [],
    max: 3,
    options: [
      { value: "a", label: "Aa" },
      { value: "b", label: "Bb" },
      { value: "c", label: "Cc" },
      { value: "d", label: "Dd", sims: ["lmu"] },
    ],
  };
  const picker = (
    values: string[],
    sim: SimName | null,
    onChange: (next: readonly string[]) => void = noop,
  ): ReactElement => FieldPicker({ field, values, sim, disabled: false, onChange });
  const boxes = (
    values: string[],
    sim: SimName | null,
    onChange: (next: readonly string[]) => void = noop,
  ): El[] => findAll(picker(values, sim, onChange), (el) => el.type === "input");
  const box = (list: El[], label: string): El | undefined =>
    list.find((el) => el.props["aria-label"] === label);

  it("shows the counter as N of max", () => {
    const html = renderToStaticMarkup(
      <FieldPicker field={field} values={["a", "b"]} sim={null} disabled={false} onChange={noop} />,
    );
    expect(html).toContain("2 of 3");
  });

  it("disables unticked boxes when full but never the ticked ones", () => {
    const list = boxes(["a", "b", "c"], null);
    expect(box(list, "Dd")?.props.disabled).toBe(true);
    expect(box(list, "Aa")?.props.disabled).toBe(false);
    expect(box(boxes(["a"], null), "Bb")?.props.disabled).toBe(false);
  });

  it("lets a field for the other sim be unticked but not ticked", () => {
    expect(box(boxes(["a"], "iracing"), "Dd")?.props.disabled).toBe(true);
    const sent: (readonly string[])[] = [];
    const list = boxes(["a", "d"], "iracing", (next) => void sent.push(next));
    expect(box(list, "Dd")?.props.disabled).toBe(false);
    (box(list, "Dd")?.props as { onChange(): void }).onChange();
    expect(sent).toEqual([["a"]]);
  });

  it("only accepts a drop that carries this picker's own drag type", () => {
    const sent: (readonly string[])[] = [];
    const chips = findAll(
      picker(["a", "b", "c"], null, (next) => void sent.push(next)),
      (el) => el.type === "li",
    );
    type Drop = {
      onDragOver(e: unknown): void;
      onDrop(e: unknown): void;
    };
    const data = (map: Record<string, string>) => {
      let prevented = false;
      return {
        e: {
          preventDefault: () => (prevented = true),
          dataTransfer: {
            types: Object.keys(map),
            getData: (t: string) => map[t] ?? "",
          },
        },
        prevented: () => prevented,
      };
    };
    const target = chips[1]!.props as unknown as Drop;
    const own = pickDragType("k");
    // Same picker: accepted, and the chip at 0 moves to 1.
    const ok = data({ [own]: "0" });
    target.onDragOver(ok.e);
    expect(ok.prevented()).toBe(true);
    target.onDrop(ok.e);
    expect(sent).toEqual([["b", "a", "c"]]);
    // Another picker's chip, a text-less drag (column handle) and a stale index do nothing.
    const other = data({ [pickDragType("other")]: "2" });
    target.onDragOver(other.e);
    expect(other.prevented()).toBe(false);
    target.onDrop(other.e);
    target.onDrop(data({}).e);
    target.onDrop(data({ [own]: "9" }).e);
    expect(sent).toHaveLength(1);
    expect(parsePickDrag("", 3)).toBeNull();
    expect(parsePickDrag("2", 3)).toBe(2);
  });

  it("ticking appends, and reorder keeps the order within the maximum", () => {
    const sent: (readonly string[])[] = [];
    const onChange = (next: readonly string[]): void => void sent.push(next);
    const tick = box(boxes(["a"], null, onChange), "Bb");
    (tick?.props as { onChange(): void }).onChange();
    const right = findAll(
      picker(["a", "b", "c"], null, onChange),
      (el) => el.props["aria-label"] === "Move right Aa",
    )[0];
    (right?.props as { onClick(): void }).onClick();
    expect(sent).toEqual([
      ["a", "b"],
      ["b", "a", "c"],
    ]);
  });
});

describe("Show title bar", () => {
  it("is a Visibility toggle that sends the common patch", () => {
    const html = render({});
    expect(html).toContain("Show title bar");
    expect(html).toContain("It always shows while overlays are unlocked.");
    const sent: unknown[] = [];
    let panel: ReactElement | null = null;
    // Render inside React so the panel's own state hook works, and keep the element tree.
    function Probe() {
      panel = OverlayPanel({
        manifest: testManifest,
        settings: defaultInstanceSettings(testManifest),
        sim: "lmu",
        prefs: DEFAULT_DISPLAY_PREFS,
        send: (patch) => sent.push(patch),
        onReset: noop,
      });
      return null;
    }
    renderToStaticMarkup(<Probe />);
    if (!panel) throw new Error("panel not rendered");
    const toggles = findAll(
      panel,
      (el) => el.props["label"] === "Show title bar" && "checked" in el.props,
    );
    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.props["checked"]).toBe(false);
    (toggles[0]?.props as { onChange(v: boolean): void }).onChange(true);
    expect(sent).toEqual([{ common: { showTitleBar: true } }]);
  });
});
