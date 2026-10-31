import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hexLuminance, licenceTextColour, readableTextColour } from "./colour";
import { ClassBadge, IRatingPill, LicencePill, PositionDelta } from "./index";

describe("text colour", () => {
  it("computes luminance", () => {
    expect(hexLuminance("#000000")).toBe(0);
    expect(hexLuminance("#fff")).toBeCloseTo(1, 5);
    expect(hexLuminance("nope")).toBeNull();
  });
  it("picks dark text on light backgrounds and light on dark", () => {
    expect(readableTextColour("#ffd800")).toBe("#000000");
    expect(readableTextColour("#ffffff")).toBe("#000000");
    expect(readableTextColour("#101010")).toBe("#ffffff");
    expect(readableTextColour("#0033cc")).toBe("#ffffff");
    expect(readableTextColour("var(--x)")).toBe("#ffffff");
  });
  it("picks licence text colours", () => {
    expect(licenceTextColour("C")).toBe("#000000");
    expect(licenceTextColour("A")).toBe("#ffffff");
    expect(licenceTextColour(null)).toBe("#ffffff");
  });
});

describe("pills", () => {
  it("renders a licence pill", () => {
    const html = renderToStaticMarkup(<LicencePill licence="Class A 3.4" />);
    expect(html).toContain("A 3.40");
    expect(html).toContain("var(--ov-locked-licence-a)");
    expect(renderToStaticMarkup(<LicencePill licence={null} />)).toContain("--");
  });
  it("tints the iRating pill only when asked and a licence is known", () => {
    const tinted = renderToStaticMarkup(<IRatingPill iRating={1550} licence="C 2.00" tinted />);
    expect(tinted).toContain("1.6k");
    expect(tinted).toContain("var(--ov-locked-licence-c)");
    expect(tinted).toContain("color:#000000");
    const plain = renderToStaticMarkup(
      <IRatingPill iRating={980} licence="C 2.00" tinted={false} />,
    );
    expect(plain).toContain("980");
    expect(plain).toContain("ov-pill--plain");
    expect(plain).not.toContain("licence-c");
    expect(renderToStaticMarkup(<IRatingPill iRating={980} tinted />)).toContain("ov-pill--plain");
  });
  it("renders a class badge with readable text", () => {
    const html = renderToStaticMarkup(<ClassBadge name="GT3" colour="#ffd800" />);
    expect(html).toContain("GT3");
    expect(html).toContain("background:#ffd800");
    expect(html).toContain("color:#000000");
  });
  it("renders position changes", () => {
    expect(renderToStaticMarkup(<PositionDelta delta={2} />)).toContain("ov-delta--gain");
    expect(renderToStaticMarkup(<PositionDelta delta={2} />)).toContain("▲2");
    expect(renderToStaticMarkup(<PositionDelta delta={-1} />)).toContain("▼1");
    expect(renderToStaticMarkup(<PositionDelta delta={-1} />)).toContain("ov-delta--loss");
    expect(renderToStaticMarkup(<PositionDelta delta={0} />)).toContain("–");
    expect(renderToStaticMarkup(<PositionDelta delta={null} />)).toContain("ov-delta--none");
  });
});
