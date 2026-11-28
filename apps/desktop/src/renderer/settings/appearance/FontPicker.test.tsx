import { THEME_FONTS, fontFamilyCss } from "@overlay/theme";
import type { ThemeFont } from "@overlay/theme/types";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FontPicker, FontPickerView, type FontPickerViewProps } from "./FontPicker";
import { FONT_LABELS, FONT_MAX_WEIGHT, FONT_SAMPLE, fontWeightNote } from "./fonts";
import { listboxKey, typeAhead, type ListboxState } from "./listbox";

const LABELS = THEME_FONTS.map((f) => FONT_LABELS[f]);
const noop = () => undefined;
const closed = (active = 0): ListboxState => ({ open: false, active });
const opened = (active: number): ListboxState => ({ open: true, active });
const key = (k: string, altKey = false) => ({ key: k, altKey });

describe("font list", () => {
  it("labels all seven fonts, in THEME_FONTS order", () => {
    expect(LABELS).toEqual([
      "Inter",
      "Manrope",
      "Oswald",
      "Barlow Condensed",
      "DM Sans",
      "Figtree",
      "Urbanist",
    ]);
  });

  it("notes a missing weight only for Oswald; the new fonts have 400 to 800", () => {
    for (const font of ["dm-sans", "figtree", "urbanist"] as const) {
      expect(FONT_MAX_WEIGHT[font]).toBe(800);
    }
    expect(fontWeightNote("oswald")).toBe("Oswald has no ExtraBold; 800 shows as Bold.");
    for (const font of THEME_FONTS.filter((f) => f !== "oswald")) {
      expect(fontWeightNote(font)).toBeUndefined();
    }
  });
});

describe("listboxKey", () => {
  const sel = 2; // Oswald is the current value

  it("opens on the current value with Down, Up, Enter and Space, and ignores other keys", () => {
    for (const k of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      expect(listboxKey(closed(), key(k), sel, LABELS)).toEqual({
        state: opened(sel),
        handled: true,
      });
    }
    expect(listboxKey(closed(), key("Home"), sel, LABELS).state).toEqual(opened(0));
    expect(listboxKey(closed(), key("End"), sel, LABELS).state).toEqual(opened(6));
    for (const k of ["Escape", "Tab", "Shift"]) {
      expect(listboxKey(closed(sel), key(k), sel, LABELS)).toEqual({
        state: closed(sel),
        handled: false,
      });
    }
  });

  it("moves the highlight with the arrows and stops at the ends", () => {
    expect(listboxKey(opened(2), key("ArrowDown"), sel, LABELS).state).toEqual(opened(3));
    expect(listboxKey(opened(2), key("ArrowUp"), sel, LABELS).state).toEqual(opened(1));
    expect(listboxKey(opened(6), key("ArrowDown"), sel, LABELS).state).toEqual(opened(6));
    expect(listboxKey(opened(0), key("ArrowUp"), sel, LABELS).state).toEqual(opened(0));
    expect(listboxKey(opened(4), key("Home"), sel, LABELS).state).toEqual(opened(0));
    expect(listboxKey(opened(1), key("End"), sel, LABELS).state).toEqual(opened(6));
    expect(listboxKey(opened(4), key("PageUp"), sel, LABELS).state).toEqual(opened(0));
    expect(listboxKey(opened(1), key("PageDown"), sel, LABELS).state).toEqual(opened(6));
  });

  it("chooses the highlighted option with Enter, Space and Alt+Up, and closes", () => {
    for (const k of [key("Enter"), key(" "), key("ArrowUp", true)]) {
      expect(listboxKey(opened(5), k, sel, LABELS)).toEqual({
        state: closed(5),
        pick: 5,
        handled: true,
      });
    }
  });

  it("closes without choosing on Escape and Tab, back on the current value", () => {
    const esc = listboxKey(opened(5), key("Escape"), sel, LABELS);
    expect(esc).toEqual({ state: closed(sel), handled: true });
    const tab = listboxKey(opened(5), key("Tab"), sel, LABELS);
    expect(tab).toEqual({ state: closed(sel), handled: false });
  });

  it("jumps by type-ahead, opening the list when it is closed", () => {
    expect(listboxKey(closed(sel), key("f"), sel, LABELS, "f")).toEqual({
      state: opened(5),
      handled: true,
    });
    expect(listboxKey(opened(0), key("u"), sel, LABELS, "u").state).toEqual(opened(6));
    expect(listboxKey(opened(0), key("x"), sel, LABELS, "x").state).toEqual(opened(0));
  });
});

describe("typeAhead", () => {
  it("matches a prefix, ignoring case, and cycles on a repeated single letter", () => {
    const labels = ["Barlow Condensed", "DM Sans", "Figtree", "Manrope", "Mono"];
    expect(typeAhead(labels, "d", 0)).toBe(1);
    expect(typeAhead(labels, "DM S", 0)).toBe(1);
    expect(typeAhead(labels, "m", 0)).toBe(3);
    expect(typeAhead(labels, "m", 3)).toBe(4);
    expect(typeAhead(labels, "m", 4)).toBe(3);
    expect(typeAhead(labels, "mo", 3)).toBe(4);
    expect(typeAhead(labels, "z", 0)).toBeNull();
    expect(typeAhead(labels, "", 0)).toBeNull();
  });
});

/** Every element in a rendered tree, depth first. Only plain DOM elements are expanded. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function view(over: Partial<FontPickerViewProps> = {}) {
  const props: FontPickerViewProps = {
    id: "fp",
    label: "Overlay font",
    value: "inter",
    weight: 600,
    open: true,
    active: 0,
    onToggle: noop,
    onKeyDown: noop,
    onBlur: noop,
    onHover: noop,
    onPick: noop,
    ...over,
  };
  return { props, tree: elements(FontPickerView(props)) };
}

describe("FontPickerView", () => {
  it("draws each option, and the button, in its own font", () => {
    const { tree } = view({ value: "figtree" });
    const options = tree.filter((e) => e.props.role === "option");
    expect(options.map((o) => o.props["data-font"])).toEqual([...THEME_FONTS]);
    for (const o of options) {
      const font = o.props["data-font"] as ThemeFont;
      expect(o.props.style).toEqual({ fontFamily: fontFamilyCss(font) });
      expect(o.props["aria-selected"]).toBe(font === "figtree");
    }
    const button = tree.find((e) => e.props.role === "combobox")!;
    expect(button.props.style).toEqual({ fontFamily: fontFamilyCss("figtree") });
  });

  it("calls onPick with the clicked font", () => {
    const onPick = vi.fn<(font: ThemeFont) => void>();
    const { tree } = view({ onPick });
    const urbanist = tree.find((e) => e.props["data-font"] === "urbanist")!;
    (urbanist.props.onClick as () => void)();
    expect(onPick).toHaveBeenCalledWith("urbanist");
  });

  it("points the button at the highlighted option while open", () => {
    const { tree } = view({ active: 4 });
    const button = tree.find((e) => e.props.role === "combobox")!;
    expect(button.props["aria-expanded"]).toBe(true);
    expect(button.props["aria-activedescendant"]).toBe("fp-opt-4");
    const active = tree.filter((e) => e.props["data-active"] === true);
    expect(active.map((e) => e.props["data-font"])).toEqual(["dm-sans"]);
  });
});

describe("FontPicker", () => {
  it("renders open with every font name and sample, the current one marked", () => {
    const html = renderToStaticMarkup(
      <FontPicker value="dm-sans" weight={700} label="Overlay font" onChange={noop} defaultOpen />,
    );
    expect(html).toMatch(/role="combobox"[^>]*aria-expanded="true"/);
    expect(html).toMatch(/aria-activedescendant="[^"]*-opt-4"/);
    expect(html).not.toMatch(/role="listbox"[^>]*hidden/);
    expect(html.match(/role="option"/g)).toHaveLength(7);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*data-font="dm-sans"/);
    expect(html.split(FONT_SAMPLE).length - 1).toBe(7);
    expect(html).toContain("font-weight:700");
    expect(html).toMatch(
      /font-family:&quot;DM Sans&quot;, system-ui, sans-serif"[^>]*><span class="ap-font-value">DM Sans</,
    );
  });
});
