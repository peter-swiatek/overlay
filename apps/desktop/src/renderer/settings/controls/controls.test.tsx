import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES } from "../pages";
import {
  Button,
  ColourInput,
  NumberStepper,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  Toggle,
  clampToStep,
  inRange,
  isColourText,
  parseNumberDraft,
} from ".";

const noop = () => undefined;

describe("settings controls", () => {
  it("renders a row with its label, help, badge and control", () => {
    const html = renderToStaticMarkup(
      <Section title="Units" description="How numbers look">
        <Row label="Speed" help="Applies live" badge="restart to apply" disabled>
          <Toggle checked onChange={noop} />
        </Row>
      </Section>,
    );
    expect(html).toContain("<h2>Units</h2>");
    expect(html).toContain("How numbers look");
    expect(html).toContain("Speed");
    expect(html).toContain("restart to apply</em>");
    expect(html).toContain("Applies live");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('checked=""');
  });

  it("disables a toggle", () => {
    expect(renderToStaticMarkup(<Toggle checked={false} onChange={noop} disabled />)).toContain(
      'disabled=""',
    );
  });

  it("marks the active segment as pressed", () => {
    const html = renderToStaticMarkup(
      <Segmented
        value="b"
        label="Pick"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onChange={noop}
      />,
    );
    expect(html).toContain('aria-label="Pick"');
    expect(html).toContain('aria-pressed="false">Alpha');
    expect(html).toContain('aria-pressed="true">Beta');
  });

  it("selects the current option and shows the slider value with its unit", () => {
    const select = renderToStaticMarkup(
      <Select
        value="y"
        options={[
          { value: "x", label: "X" },
          { value: "y", label: "Y", disabled: true },
        ]}
        onChange={noop}
      />,
    );
    expect(select).toContain('<option value="y" disabled="" selected="">Y</option>');
    const slider = renderToStaticMarkup(
      <Slider value={80} min={20} max={100} step={5} unit="%" onChange={noop} />,
    );
    expect(slider).toContain("80 %</output>");
  });

  it("renders a number stepper with value, unit and disabled end buttons", () => {
    const html = renderToStaticMarkup(
      <NumberStepper value={100} min={50} max={100} step={5} unit="%" onChange={noop} />,
    );
    expect(html).toContain('value="100"');
    expect(html).toContain("%</span>");
    expect(html).toMatch(
      /aria-label="Increase"[^>]*disabled=""|disabled=""[^>]*aria-label="Increase"/,
    );
    const off = renderToStaticMarkup(
      <NumberStepper value={70} min={50} max={100} step={5} onChange={noop} disabled />,
    );
    expect(off).toContain('disabled=""');
  });

  it("clamps and snaps numbers", () => {
    expect(clampToStep(120, 50, 100, 5)).toBe(100);
    expect(clampToStep(10, 50, 100, 5)).toBe(50);
    expect(clampToStep(62, 50, 100, 5)).toBe(60);
    expect(clampToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    expect(clampToStep(7, 0, 10, 0)).toBe(7);
  });

  it("parses a typed number only when it is complete", () => {
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("  ")).toBeNull();
    expect(parseNumberDraft("-")).toBeNull();
    expect(parseNumberDraft("1e")).toBeNull();
    expect(parseNumberDraft("75")).toBe(75);
    expect(parseNumberDraft("7.5")).toBe(7.5);
    expect(inRange(75, 50, 100)).toBe(true);
    expect(inRange(7, 50, 100)).toBe(false);
  });

  it("accepts alpha colours only when allowed", () => {
    expect(isColourText("#ffc400", false)).toBe(true);
    expect(isColourText("#ffc40047", false)).toBe(false);
    expect(isColourText("#ffc40047", true)).toBe(true);
    expect(isColourText("ffc400", true)).toBe(false);
    expect(isColourText("#ffc4", true)).toBe(false);
    const html = renderToStaticMarkup(
      <ColourInput value="#ffc40047" allowAlpha onChange={noop} onReset={noop} resetLabel="Undo" />,
    );
    expect(html).toContain('type="color"');
    expect(html).toContain('value="#ffc400"');
    expect(html).toContain("Undo</button>");
  });

  it("renders button variants", () => {
    const html = renderToStaticMarkup(
      <Button variant="danger" disabled>
        Delete
      </Button>,
    );
    expect(html).toContain('data-variant="danger"');
    expect(html).toContain('disabled=""');
  });

  it("lists the settings pages in order with only developer marked dev-only", () => {
    expect(SETTINGS_PAGES.map((p) => p.id)).toEqual([
      "overlays",
      "appearance",
      "general",
      "performance",
      "display",
      "developer",
    ]);
    expect(SETTINGS_PAGES.filter((p) => p.devOnly).map((p) => p.id)).toEqual(["developer"]);
  });
});
