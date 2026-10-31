import { describe, expect, it } from "vitest";
import { decodeSimLines, decodeSimText } from "./sim-text";

describe("decodeSimLines", () => {
  it("decodes each line on its own, so mixed encodings survive", () => {
    const bytes = Buffer.concat([
      Buffer.from("A: José María Pérez\n", "utf8"),
      Buffer.from("B: Ma", "latin1"),
      Uint8Array.of(0x8a),
      Buffer.from("a\nC: plain\n"),
      Uint8Array.of(0),
      Buffer.from("ignored"),
    ]);
    expect(decodeSimLines(bytes)).toBe("A: José María Pérez\nB: MaŠa\nC: plain\n");
  });
});

const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));

describe("decodeSimText", () => {
  it("decodes valid UTF-8 names", () => {
    expect(decodeSimText(utf8("José María Pérez"))).toBe("José María Pérez");
  });

  it("decodes Windows-1252 when the bytes are not UTF-8", () => {
    expect(decodeSimText(Uint8Array.of(0x8a, 0x61, 0x9e, 0x61))).toBe("Šaža");
    expect(decodeSimText(Uint8Array.of(0x4a, 0x6f, 0x73, 0xe9))).toBe("José");
  });

  it("passes ASCII through", () => {
    expect(decodeSimText(utf8("Plain Name 42"))).toBe("Plain Name 42");
  });

  it("stops at the first NUL", () => {
    const bytes = Uint8Array.from([...utf8("Zoë"), 0, 0xff, 0x41]);
    expect(decodeSimText(bytes)).toBe("Zoë");
  });

  it("falls back for invalid UTF-8 instead of emitting U+FFFD", () => {
    const text = decodeSimText(Uint8Array.of(0xc3, 0x28, 0xe9));
    expect(text).not.toContain("�");
    expect(text).toBe("Ã(é");
  });

  it("handles empty input", () => {
    expect(decodeSimText(new Uint8Array(0))).toBe("");
    expect(decodeSimText(Uint8Array.of(0, 0x41))).toBe("");
  });
});
