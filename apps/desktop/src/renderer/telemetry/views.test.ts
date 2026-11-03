import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import { statusNotice } from "./views";

function liveFrame(): TelemetryFrame {
  return {
    seq: 1,
    source: "mock",
    status: "live",
    error: null,
    state: emptySimState("mock"),
    derived: {
      fuel: null,
      energy: null,
      track: { trackKey: null, outlineReady: false },
      standings: null,
      proximity: null,
      delta: null,
      slowCar: null,
      gaps: [],
    },
  };
}

describe("statusNotice", () => {
  it("shows Waiting for sim before data and while waiting", () => {
    expect(statusNotice(null)).toBe("Waiting for sim");
    expect(statusNotice({ ...liveFrame(), status: "waiting" })).toBe("Waiting for sim");
  });

  it("shows No data when the stream is stale", () => {
    expect(statusNotice(liveFrame(), true)).toBe("No data");
    expect(statusNotice(null, true)).toBe("No data");
  });

  it("shows the error text, and nothing when live", () => {
    expect(statusNotice({ ...liveFrame(), status: "error", error: "Cannot open file" })).toBe(
      "Cannot open file",
    );
    expect(statusNotice(liveFrame())).toBeNull();
  });
});
