import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES } from "../pages";
import { ColourInput, Row, Section, Segmented, Select, Slider, Toggle, isColourText } from ".";

describe("settings controls", () => {
  it("renders a row with its label, badge and control", () => {
    const html = renderToStaticMarkup(
      <Section title="Units">
        <Row label="Speed" badge="restart to apply">
          <Toggle checked onChange={() => undefined} />
        </Row>
      </Section>,
    );
    expect(html).toContain("<h2>Units</h2>");
    expect(html).toContain("<span>Speed</span>");
    expect(html).toContain("<em>restart to apply</em>");
    expect(html).toContain('checked=""');
  });

  it("marks the active segment as pressed", () => {
    const html = renderToStaticMarkup(
      <Segmented
        value="b"
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        onChange={() => undefined}
      />,
    );
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
        onChange={() => undefined}
      />,
    );
    expect(select).toContain('<option value="y" disabled="" selected="">Y</option>');
    const slider = renderToStaticMarkup(
      <Slider value={80} min={20} max={100} step={5} unit="%" onChange={() => undefined} />,
    );
    expect(slider).toContain("<output>80 %</output>");
  });

  it("accepts alpha colours only when allowed", () => {
    expect(isColourText("#ffc400", false)).toBe(true);
    expect(isColourText("#ffc40047", false)).toBe(false);
    expect(isColourText("#ffc40047", true)).toBe(true);
    expect(isColourText("ffc400", true)).toBe(false);
    const html = renderToStaticMarkup(
      <ColourInput value="#ffc40047" allowAlpha onChange={() => undefined} />,
    );
    expect(html).toContain('type="color" value="#ffc400"');
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
