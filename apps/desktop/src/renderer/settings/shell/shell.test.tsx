import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Segmented, Toggle } from "../controls";
import { OverflowMenu, TopBarView, type TopBarViewProps } from "./TopBar";
import { DEFAULT_APP_SETTINGS } from "../../../shared/app-settings-types";
import { WELCOME_TEXT, WelcomeCard, welcomeVisible } from "./Welcome";

type AnyElement = ReactElement<Record<string, unknown>>;

/** Depth-first search of an element tree (function components are not expanded). */
function find(node: ReactNode, match: (el: AnyElement) => boolean): AnyElement | undefined {
  if (!isValidElement(node)) return undefined;
  const el = node as AnyElement;
  if (match(el)) return el;
  for (const child of Children.toArray(el.props.children as ReactNode)) {
    const hit = find(child, match);
    if (hit) return hit;
  }
  return undefined;
}

function props(patch: Partial<TopBarViewProps> = {}): TopBarViewProps {
  return {
    version: "0.1.0",
    source: "auto",
    developerEnabled: false,
    status: null,
    appState: { overlaysVisible: true, overlaysLocked: true },
    onSource: vi.fn(),
    onVisible: vi.fn(),
    onLocked: vi.fn(),
    onQuit: vi.fn(),
    ...patch,
  };
}

function toggle(tree: ReactNode, label: string): AnyElement {
  const el = find(tree, (e) => e.type === Toggle && e.props.label === label);
  if (!el) throw new Error(`no toggle ${label}`);
  return el;
}

describe("TopBarView", () => {
  it("shows the name, version, game choice and connection label", () => {
    const html = renderToStaticMarkup(
      <TopBarView
        {...props({
          source: "lmu",
          status: { type: "status", status: "live", source: "lmu", error: null },
        })}
      />,
    );
    expect(html).toContain("Overlay");
    expect(html).toContain("0.1.0");
    expect(html).toMatch(/aria-pressed="true"[^>]*>LMU</);
    expect(html).toContain("LMU connected");
  });

  it("calls setSource-bound handler with the picked game", () => {
    const p = props();
    const seg = find(TopBarView(p), (e) => e.type === Segmented);
    (seg?.props.onChange as (v: string) => void)("lmu");
    expect(p.onSource).toHaveBeenCalledWith("lmu");
  });

  it("hides Mock and Replay unless developer tools are on or one is selected", () => {
    const labels = (patch: Partial<TopBarViewProps>): string[] => {
      const seg = find(TopBarView(props(patch)), (e) => e.type === Segmented);
      return (seg?.props.options as { label: string }[]).map((o) => o.label);
    };
    expect(labels({})).toEqual(["Auto", "iRacing", "LMU"]);
    expect(labels({ developerEnabled: true })).toEqual([
      "Auto",
      "iRacing",
      "LMU",
      "Mock",
      "Replay",
    ]);
    expect(labels({ source: "mock" })).toEqual(["Auto", "iRacing", "LMU", "Mock"]);
  });

  it("reflects the app state in the Visible and Locked toggles", () => {
    const tree = TopBarView(props({ appState: { overlaysVisible: false, overlaysLocked: false } }));
    expect(toggle(tree, "Visible").props.checked).toBe(false);
    expect(toggle(tree, "Locked").props.checked).toBe(false);
  });

  it("passes toggle changes on and disables them before the state is known", () => {
    const p = props();
    const tree = TopBarView(p);
    (toggle(tree, "Visible").props.onChange as (v: boolean) => void)(false);
    (toggle(tree, "Locked").props.onChange as (v: boolean) => void)(false);
    expect(p.onVisible).toHaveBeenCalledWith(false);
    expect(p.onLocked).toHaveBeenCalledWith(false);
    expect(toggle(TopBarView(props({ appState: null })), "Locked").props.disabled).toBe(true);
  });

  it("wires the overflow menu to quit", () => {
    const p = props();
    const menu = find(TopBarView(p), (e) => e.type === OverflowMenu);
    (menu?.props.onQuit as () => void)();
    expect(p.onQuit).toHaveBeenCalled();
  });
});

describe("OverflowMenu", () => {
  it("is closed until opened", () => {
    const html = renderToStaticMarkup(<OverflowMenu onQuit={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Quit Overlay");
  });
});

describe("welcomeVisible", () => {
  it("shows until dismissed and then stays hidden", () => {
    const general = DEFAULT_APP_SETTINGS.general;
    expect(welcomeVisible(null)).toBe(false);
    expect(welcomeVisible(DEFAULT_APP_SETTINGS)).toBe(true);
    expect(
      welcomeVisible({
        ...DEFAULT_APP_SETTINGS,
        general: { ...general, welcomeDismissed: true },
      }),
    ).toBe(false);
  });
});

describe("WelcomeCard", () => {
  it("shows the welcome text and a Got it button that dismisses", () => {
    const onDismiss = vi.fn();
    const card = WelcomeCard({ onDismiss });
    expect(renderToStaticMarkup(card)).toContain(WELCOME_TEXT);
    expect(WELCOME_TEXT).toContain("Closing this window keeps them running.");
    const button = find(card, (e) => e.type === "button");
    expect(button?.props.children).toBe("Got it");
    (button?.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalled();
  });
});
