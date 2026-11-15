import { CAR_MAKES } from "@overlay/sim-core/pure";
import { THEME_PRESETS } from "@overlay/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_LOGOS,
  CHIP_LOGOS,
  DARK_LUMINANCE,
  DARK_ROWS,
  bundledLogos,
  resolveLogo,
  rowTones,
} from "./make-logos";
import { MakeBadge, NationalityFlag } from "./MakeBadge";
import { flagUrl } from "./nationality-flags";
import { NATIONALITY_CODES } from "@overlay/sim-core/pure";

const preset = (id: string) => {
  const theme = THEME_PRESETS.find((t) => t.id === id);
  if (theme === undefined) throw new Error(id);
  return theme.tokens;
};

describe("bundledLogos", () => {
  it("pairs <id> files with their <id>.on-light variants and skips other names", () => {
    const logos = bundledLogos({
      "./make-logos/riley.png": "riley-white",
      "./make-logos/riley.on-light.png": "riley-black",
      "./make-logos/aston-martin.svg": "am",
      "./make-logos/orphan.on-light.svg": "orphan",
      "./make-logos/README.txt": "x",
      "./make-logos/Bad Name.svg": "x",
    });
    expect(logos).toEqual({
      riley: { dark: "riley-white", light: "riley-black" },
      "aston-martin": { dark: "am" },
    });
  });
});

describe("the bundled logo set", () => {
  it("has a logo for every make but Vanwall", () => {
    const missing = Object.keys(CAR_MAKES).filter((id) => BUNDLED_LOGOS[id] === undefined);
    expect(missing).toEqual(["vanwall"]);
  });

  it("has no logo for a make sim-core does not know", () => {
    for (const id of Object.keys(BUNDLED_LOGOS)) expect(CAR_MAKES[id]).toBeDefined();
  });

  it("has both Riley variants and the owner-supplied logos", () => {
    expect(BUNDLED_LOGOS["riley"]?.light).toBeDefined();
    expect(BUNDLED_LOGOS["oreca"]?.light).toBeDefined();
    for (const id of ["oreca", "isotta-fraschini", "dallara", "glickenhaus", "riley", "duqueine"])
      expect(BUNDLED_LOGOS[id]).toBeDefined();
  });

  it("draws only bundled makes on a chip", () => {
    for (const id of CHIP_LOGOS) expect(BUNDLED_LOGOS[id]).toBeDefined();
  });
});

describe("resolveLogo", () => {
  const bundled = {
    riley: { dark: "white.png", light: "black.png" },
    porsche: { dark: "porsche.svg" },
    ligier: { dark: "ligier.png" },
  };

  it("picks the light-row variant only on light rows", () => {
    expect(resolveLogo("riley", "dark", {}, bundled)).toEqual({ src: "white.png", chip: false });
    expect(resolveLogo("riley", "light", {}, bundled)).toEqual({ src: "black.png", chip: false });
    expect(resolveLogo("porsche", "light", {}, bundled)?.src).toBe("porsche.svg");
  });

  it("puts chip logos on a chip", () => {
    expect(resolveLogo("ligier", "dark", {}, bundled)).toEqual({ src: "ligier.png", chip: true });
  });

  it("lets the user's file win on any row, never on a chip", () => {
    const own = { riley: "data:image/png;base64,AAAA", ligier: "data:image/svg+xml;base64,BBBB" };
    expect(resolveLogo("riley", "light", own, bundled)).toEqual({ src: own.riley, chip: false });
    expect(resolveLogo("ligier", "dark", own, bundled)).toEqual({ src: own.ligier, chip: false });
  });

  it("is null for a make with neither", () => {
    expect(resolveLogo("vanwall", "dark", {}, bundled)).toBeNull();
  });
});

describe("rowTones", () => {
  it("puts the threshold where black and white text contrast alike", () => {
    expect((1 + 0.05) / (DARK_LUMINANCE + 0.05)).toBeCloseTo((DARK_LUMINANCE + 0.05) / 0.05, 9);
  });

  it("sees the dark presets as dark rows and Glacier as light rows", () => {
    for (const id of ["graphite", "midnight", "carbon"])
      expect(rowTones(preset(id))).toEqual(DARK_ROWS);
    expect(rowTones(preset("glacier")).row).toBe("light");
  });

  it("follows the own-row highlight separately from the rows", () => {
    const tokens = { ...preset("graphite"), ownRow: "#ffffffe6" };
    expect(rowTones(tokens)).toEqual({ row: "dark", own: "light" });
    const light = { ...preset("glacier"), ownRow: "#000000e6" };
    expect(rowTones(light)).toEqual({ row: "light", own: "dark" });
  });

  it("treats a transparent panel as the dark sim image behind it", () => {
    const tokens = { backgroundTint: "#00000000", row: "#00000000", ownRow: "#00000000" };
    expect(rowTones(tokens)).toEqual(DARK_ROWS);
  });
});

describe("MakeBadge", () => {
  const html = (el: JSX.Element) => renderToStaticMarkup(el);

  it("draws the bundled logo, named for the make", () => {
    const out = html(<MakeBadge make="porsche" tone="dark" />);
    expect(out).toContain('class="ov-make-logo"');
    expect(out).toContain('alt="Porsche"');
    expect(out).toContain(`src="${BUNDLED_LOGOS["porsche"]?.dark}"`);
  });

  it("draws Riley's light-row variant on light rows", () => {
    expect(html(<MakeBadge make="riley" tone="light" />)).toContain(
      `src="${BUNDLED_LOGOS["riley"]?.light}"`,
    );
    expect(html(<MakeBadge make="riley" tone="dark" />)).toContain(
      `src="${BUNDLED_LOGOS["riley"]?.dark}"`,
    );
  });

  it("puts PNG logos made for white pages on a chip", () => {
    expect(html(<MakeBadge make="ligier" tone="dark" />)).toContain("ov-make-logo--chip");
  });

  it("uses the user's file over the bundled one", () => {
    const out = html(
      <MakeBadge make="porsche" tone="dark" overrides={{ porsche: "data:image/png;base64,AA" }} />,
    );
    expect(out).toContain('src="data:image/png;base64,AA"');
  });

  it("shows the text code when there is no logo, and nothing for no make", () => {
    expect(html(<MakeBadge make="vanwall" tone="dark" />)).toBe(
      '<span class="ov-make-code" title="Vanwall">VAN</span>',
    );
    expect(html(<MakeBadge make="zenvo" tone="dark" />)).toContain(">ZEN<");
    expect(html(<MakeBadge make={null} tone="dark" />)).toBe("");
  });
});

describe("NationalityFlag", () => {
  it("has a flag for every code sim-core can return", () => {
    const missing = NATIONALITY_CODES.filter((code) => flagUrl(code) === null);
    expect(missing).toEqual([]);
  });

  it("draws the flag, or nothing for an unknown or missing code", () => {
    const out = renderToStaticMarkup(<NationalityFlag code="gb-sct" />);
    expect(out).toContain('class="ov-flag"');
    expect(out).toContain('alt="GB-SCT"');
    expect(renderToStaticMarkup(<NationalityFlag code="zz" />)).toBe("");
    expect(renderToStaticMarkup(<NationalityFlag code={null} />)).toBe("");
  });
});
