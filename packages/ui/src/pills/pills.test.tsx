import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hexLuminance, licenceTextColour, readableTextColour } from "./colour";
import { HELMET_PATH } from "./helmet";
import {
  CarCount,
  CarNumberBadge,
  ClassBadge,
  FlagBadge,
  IRatingPill,
  LicencePill,
  PositionDelta,
} from "./index";

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
    expect(licenceTextColour("B")).toBe("#000000");
    expect(licenceTextColour("D")).toBe("#000000");
    expect(licenceTextColour("R")).toBe("#000000"); // L = 0.185, just over the 0.179 crossover
    expect(licenceTextColour("P")).toBe("#ffffff");
  });
});

const css = readFileSync(join(__dirname, "pills.css"), "utf8");

describe("pills", () => {
  it("renders a split licence pill for every class", () => {
    for (const [lic, cls] of [
      ["A 3.41", "a"],
      ["B 2.1", "b"],
      ["C 1.5", "c"],
      ["D 2.0", "d"],
      ["R 2.5", "r"],
      ["P 4.5", "pro"],
    ] as const) {
      const html = renderToStaticMarkup(<LicencePill licence={lic} />);
      expect(html).toContain(`ov-pill ov-pill--lic-${cls}`);
      expect(html).toContain('<span class="ov-lic-ltr">');
      expect(html).toContain('<span class="ov-lic-num">');
    }
    expect(renderToStaticMarkup(<LicencePill licence="Class A 3.4" />)).toBe(
      '<span class="ov-pill ov-pill--lic-a" aria-label="Licence A 3.40"><span class="ov-lic-ltr">A</span><span class="ov-lic-num">3.40</span></span>',
    );
    expect(renderToStaticMarkup(<LicencePill licence="P 4.5" />)).toContain(">P</span>");
  });
  it("shows only the letter without a safety rating, and plain dashes when unknown", () => {
    const html = renderToStaticMarkup(<LicencePill licence="B" />);
    expect(html).toContain("ov-lic-ltr");
    expect(html).not.toContain("ov-lic-num");
    expect(html).toContain('aria-label="Licence B"');
    const unknown = renderToStaticMarkup(<LicencePill licence={null} />);
    expect(unknown).toBe('<span class="ov-pill ov-pill--plain">--</span>');
  });
  it("takes every licence colour, Pro included, from its locked variable", () => {
    expect(css).toContain("--lic-color: var(--ov-locked-licence-pro)");
    expect(css).not.toContain("#475569");
    expect(css).toMatch(
      /\.ov-pill--lic-c \.ov-lic-ltr,\s*\.ov-pill--lic-d \.ov-lic-ltr\s*\{\s*color: #0b0d12;/,
    );
    expect(css).toContain("padding: 0 0.34em 0 0.44em");
    expect(css).toContain("min-width: 1.62em");
    expect(css).toContain("padding: 0 0.5em 0 0.4em");
    expect(css).not.toContain("0.62em");
  });
  it("draws flag badges as 3px rounded rectangles, not pills", () => {
    const rule = /\.ov-badge-flag \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("border-radius: 3px");
    expect(rule).not.toContain("999px");
  });
  it("tints the iRating pill only when asked and a licence is known", () => {
    const tinted = renderToStaticMarkup(<IRatingPill iRating={1550} licence="C 2.00" tinted />);
    expect(tinted).toContain("1.6k");
    expect(tinted).toContain("ov-pill--ir-tinted");
    expect(tinted).toContain("var(--ov-locked-licence-c)");
    expect(tinted).toContain("color:#000000");
    const plain = renderToStaticMarkup(
      <IRatingPill iRating={980} licence="C 2.00" tinted={false} />,
    );
    expect(plain).toContain('<span class="ov-ir-val">980</span>');
    expect(plain).toContain("ov-pill ov-pill--ir");
    expect(plain).not.toContain("licence-c");
    expect(plain).not.toContain("ov-pill--ir-tinted");
    expect(renderToStaticMarkup(<IRatingPill iRating={980} tinted />)).not.toContain("tinted");
  });
  it("shows the iRating change with its direction", () => {
    const up = renderToStaticMarkup(<IRatingPill iRating={2400} tinted={false} change={11} />);
    expect(up).toContain("ov-ir-delta ov-ir-delta--up");
    expect(up).toContain('<span class="ov-ir-tri">\u25B2</span>11');
    const down = renderToStaticMarkup(<IRatingPill iRating={2400} tinted={false} change={-7} />);
    expect(down).toContain("ov-ir-delta--down");
    expect(down).toContain("\u25BC</span>7");
    for (const change of [0, null, undefined, Number.NaN, Infinity]) {
      expect(
        renderToStaticMarkup(<IRatingPill iRating={2400} tinted={false} change={change} />),
      ).not.toContain("ov-ir-delta");
    }
    const tintedUp = renderToStaticMarkup(
      <IRatingPill iRating={2400} licence="A 3.0" tinted change={4} />,
    );
    expect(tintedUp).toContain("ov-ir-delta--up");
    expect(tintedUp).toContain("var(--ov-locked-licence-a)");
  });
  it("renders fixed-size iRating pills", () => {
    const narrow = renderToStaticMarkup(
      <IRatingPill iRating={10400} tinted={false} change={123} size="narrow" />,
    );
    expect(narrow).toContain("ov-pill--ir-narrow");
    expect(narrow).toContain("10.4k");
    expect(narrow).not.toContain("ov-ir-delta");
    const wide = renderToStaticMarkup(
      <IRatingPill iRating={10400} tinted={false} change={-123} size="wide" />,
    );
    expect(wide).toContain("ov-pill--ir-wide");
    expect(wide).toContain("ov-ir-delta ov-ir-delta--fixed ov-ir-delta--down");
    expect(wide).toContain("\u25BC</span>123");
    // No change: the fixed block stays, empty, so the pill keeps its width.
    for (const change of [0, null, undefined]) {
      const none = renderToStaticMarkup(
        <IRatingPill iRating={950} tinted={false} change={change} size="wide" />,
      );
      expect(none).toContain('<span class="ov-ir-delta ov-ir-delta--fixed"></span>');
    }
    const auto = renderToStaticMarkup(<IRatingPill iRating={950} tinted={false} size="auto" />);
    expect(auto).not.toContain("ov-pill--ir-");
  });
  it("sizes the fixed pills in CSS with a right-justified change block", () => {
    expect(css).toMatch(/\.ov-pill--ir-narrow\s*\{[^}]*width:/);
    expect(css).toMatch(/\.ov-pill--ir-wide\s*\{[^}]*width:/);
    expect(css).toMatch(/\.ov-ir-delta--fixed\s*\{[^}]*justify-content:\s*flex-end/);
  });
  it("renders the car count with a decorative helmet", () => {
    const html = renderToStaticMarkup(<CarCount count={12} />);
    expect(html).toContain('aria-label="12 cars"');
    expect(html).toContain('<svg class="ov-helmet" viewBox="0 0 362 376" aria-hidden="true"');
    expect(html).toContain(HELMET_PATH.slice(0, 20));
    expect(renderToStaticMarkup(<CarCount count={1} />)).toContain('aria-label="1 car"');
  });
  it("renders a flag badge for each kind", () => {
    for (const [kind, label] of [
      ["yel", "YEL"],
      ["off", "OFF"],
      ["pit", "PIT"],
      ["dsq", "DSQ"],
      ["blk", "BLK"],
      ["dmg", "DMG"],
    ] as const) {
      expect(renderToStaticMarkup(<FlagBadge kind={kind} />)).toBe(
        `<span class="ov-badge-flag ov-badge-flag--${kind}">${label}</span>`,
      );
    }
  });
  it("renders the car number badge", () => {
    expect(renderToStaticMarkup(<CarNumberBadge carNumber="5" />)).toBe(
      '<span class="ov-car-num">5</span>',
    );
    expect(renderToStaticMarkup(<CarNumberBadge carNumber={null} />)).toContain("--");
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
