import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES } from "./pages";
import { resolvePageId, statusLabel, statusTone, visiblePages, zoomOf } from "./shell-model";

describe("shell model", () => {
  it("hides developer-only pages unless developer tools are on", () => {
    expect(visiblePages(SETTINGS_PAGES, false).map((p) => p.id)).toEqual([
      "overlays",
      "appearance",
      "general",
      "performance",
      "display",
    ]);
    expect(visiblePages(SETTINGS_PAGES, true).map((p) => p.id)).toContain("developer");
  });

  it("falls back to the first page when the remembered one is hidden or unknown", () => {
    const pages = visiblePages(SETTINGS_PAGES, false);
    expect(resolvePageId(pages, "developer")).toBe("overlays");
    expect(resolvePageId(pages, null)).toBe("overlays");
    expect(resolvePageId(pages, "performance")).toBe("performance");
    expect(resolvePageId([], "performance")).toBeUndefined();
  });

  it("words the telemetry status", () => {
    const ev = (
      status: "live" | "waiting" | "error",
      source: "iracing" | "lmu" | "replay" | "mock" | null,
      error: string | null = null,
    ) => ({ type: "status" as const, status, source, error });
    expect(statusLabel(null)).toBe("Waiting for sim");
    expect(statusLabel(ev("waiting", null))).toBe("Waiting for sim");
    expect(statusLabel(ev("live", "iracing"))).toBe("iRacing connected");
    expect(statusLabel(ev("live", "lmu"))).toBe("LMU connected");
    expect(statusLabel(ev("live", "replay"))).toBe("Replay");
    expect(statusLabel(ev("live", "mock"))).toBe("Mock");
    expect(statusLabel(ev("error", null, "Shared memory busy"))).toBe("Shared memory busy");
    expect(statusTone(ev("live", "lmu"))).toBe("ok");
    expect(statusTone(ev("error", null, "x"))).toBe("error");
    expect(statusTone(null)).toBe("idle");
  });

  it("converts the UI scale to a zoom factor", () => {
    expect(zoomOf(100)).toBe(1);
    expect(zoomOf(125)).toBe(1.25);
  });
});
