import { describe, expect, it } from "vitest";
import { MAX_WEB_URL_LENGTH, isEmptyOrWebPageUrl, isWebPageUrl, parseWebPageUrl } from "./web-url";

describe("parseWebPageUrl", () => {
  it("accepts http and https addresses and normalises them", () => {
    expect(parseWebPageUrl("http://127.0.0.1:8888/Dash/Endurance")).toBe(
      "http://127.0.0.1:8888/Dash/Endurance",
    );
    expect(parseWebPageUrl("  https://example.com  ")).toBe("https://example.com/");
    expect(parseWebPageUrl("HTTP://LOCALHOST:8080/a?b=1#c")).toBe("http://localhost:8080/a?b=1#c");
    expect(parseWebPageUrl("http://[::1]:9000/")).toBe("http://[::1]:9000/");
  });

  it("refuses every other scheme", () => {
    for (const url of [
      "file:///C:/Windows/win.ini",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "blob:https://example.com/1",
      "about:blank",
      "chrome://gpu",
      "devtools://devtools/bundled/inspector.html",
      "ftp://example.com/",
      "ws://localhost:8080/",
      "view-source:https://example.com",
      "mailto:a@example.com",
    ]) {
      expect(parseWebPageUrl(url), url).toBeNull();
    }
  });

  it("refuses empty, relative and malformed input", () => {
    for (const url of ["", "   ", "example.com", "/dash", "//example.com", "http://", "https:"]) {
      expect(parseWebPageUrl(url), url).toBeNull();
    }
    expect(parseWebPageUrl(undefined)).toBeNull();
    expect(parseWebPageUrl(42)).toBeNull();
    expect(parseWebPageUrl(null)).toBeNull();
  });

  it("refuses credentials, inner whitespace and control characters", () => {
    expect(parseWebPageUrl("http://user:pass@localhost/")).toBeNull();
    expect(parseWebPageUrl("http://user@localhost/")).toBeNull();
    expect(parseWebPageUrl("http://local host/")).toBeNull();
    expect(parseWebPageUrl("java\tscript:alert(1)")).toBeNull();
    expect(parseWebPageUrl("http://localhost/\na")).toBeNull();
    expect(parseWebPageUrl("http://localhost/\u0000")).toBeNull();
  });

  it("refuses addresses longer than the limit", () => {
    const base = "http://localhost/";
    const fits = base + "a".repeat(MAX_WEB_URL_LENGTH - base.length);
    expect(parseWebPageUrl(fits)).toBe(fits);
    expect(parseWebPageUrl(fits + "a")).toBeNull();
  });
});

describe("isWebPageUrl / isEmptyOrWebPageUrl", () => {
  it("tells page addresses apart", () => {
    expect(isWebPageUrl("https://example.com")).toBe(true);
    expect(isWebPageUrl("file:///x")).toBe(false);
    expect(isEmptyOrWebPageUrl("")).toBe(true);
    expect(isEmptyOrWebPageUrl("  ")).toBe(true);
    expect(isEmptyOrWebPageUrl("http://localhost:8888/")).toBe(true);
    expect(isEmptyOrWebPageUrl("javascript:void(0)")).toBe(false);
    expect(isEmptyOrWebPageUrl(3)).toBe(false);
  });
});
