import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  LogoOverrides,
  MAX_LOGO_BYTES,
  readLogoOverrides,
  showsMakeColumn,
  type LogoFs,
} from "./logo-overrides";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>');

function fakeFs(files: Record<string, Buffer>, sizes: Record<string, number> = {}): LogoFs {
  return {
    readdir: (dir) => {
      if (dir !== "/logos") throw new Error("ENOENT");
      return Object.keys(files);
    },
    size: (path) => sizes[path.split(/[\\/]/).pop()!] ?? files[path.split(/[\\/]/).pop()!]!.length,
    read: (path) => {
      const file = files[path.split(/[\\/]/).pop()!];
      if (file === undefined) throw new Error("ENOENT");
      return file;
    },
  };
}

const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("readLogoOverrides", () => {
  it("reads <make-id>.svg and .png files as data URLs", () => {
    const logos = readLogoOverrides(
      "/logos",
      fakeFs({ "porsche.png": PNG, "aston-martin.svg": SVG }),
    );
    expect(logos).toEqual({
      "aston-martin": dataUrl("image/svg+xml", SVG),
      porsche: dataUrl("image/png", PNG),
    });
  });

  it("prefers the SVG when a make has both", () => {
    const logos = readLogoOverrides("/logos", fakeFs({ "bmw.png": PNG, "bmw.svg": SVG }));
    expect(logos).toEqual({ bmw: dataUrl("image/svg+xml", SVG) });
  });

  it("falls back to the PNG when the SVG is not really one", () => {
    const logos = readLogoOverrides(
      "/logos",
      fakeFs({ "bmw.png": PNG, "bmw.svg": Buffer.from("hello") }),
    );
    expect(logos).toEqual({ bmw: dataUrl("image/png", PNG) });
  });

  it("accepts an upper-case extension but not a name that is not a make id", () => {
    const logos = readLogoOverrides(
      "/logos",
      fakeFs({
        "ferrari.PNG": PNG,
        "Ferrari.png": PNG,
        "aston martin.svg": SVG,
        "-bad.svg": SVG,
        "notes.txt": SVG,
        "mclaren.jpg": PNG,
      }),
    );
    expect(Object.keys(logos)).toEqual(["ferrari"]);
  });

  it("skips files that are too large or not what their name says", () => {
    const logos = readLogoOverrides(
      "/logos",
      fakeFs(
        { "audi.png": PNG, "kia.png": SVG, "mini.svg": PNG },
        { "audi.png": MAX_LOGO_BYTES + 1 },
      ),
    );
    expect(logos).toEqual({});
  });

  it("is empty when the folder is missing", () => {
    expect(readLogoOverrides("/nowhere", fakeFs({}))).toEqual({});
  });
});

describe("LogoOverrides", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("tells its listeners only when the folder's logos change", () => {
    dir = mkdtempSync(join(tmpdir(), "logos-"));
    const logos = new LogoOverrides(dir);
    const seen: Record<string, string>[] = [];
    logos.onChange((next) => seen.push(next));
    expect(logos.reload()).toBe(false);
    writeFileSync(join(dir, "riley.png"), PNG);
    expect(logos.reload()).toBe(true);
    expect(logos.reload()).toBe(false);
    expect(Object.keys(logos.get())).toEqual(["riley"]);
    writeFileSync(join(dir, "riley.svg"), SVG);
    expect(logos.reload()).toBe(true);
    expect(seen.map((s) => s["riley"]?.slice(0, 18))).toEqual([
      "data:image/png;bas",
      "data:image/svg+xml",
    ]);
  });

  it("creates the folder when it starts watching", () => {
    dir = mkdtempSync(join(tmpdir(), "logos-"));
    const logos = new LogoOverrides(join(dir, "logos"));
    logos.watch();
    expect(existsSync(join(dir, "logos"))).toBe(true);
    logos.close();
  });
});

describe("showsMakeColumn", () => {
  it("is true only with a visible make field", () => {
    const of = (visible: boolean) => ({
      common: {
        fields: [
          { id: "make", visible },
          { id: "position", visible: true },
        ],
      },
    });
    expect(showsMakeColumn(of(true))).toBe(true);
    expect(showsMakeColumn(of(false))).toBe(false);
    expect(showsMakeColumn({ common: { fields: [] } })).toBe(false);
  });
});
