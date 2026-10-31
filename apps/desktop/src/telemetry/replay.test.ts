import { describe, expect, it } from "vitest";
import { isSimState } from "@overlay/sim-core";
import { ReplayTelemetrySource } from "./replay";
import { IRACING_RACE_START, IRACING_SESSION_CHANGE, LMU_ON_PACE } from "./testing";

async function drain(source: ReplayTelemetrySource, max = Infinity) {
  const frames = [];
  while (frames.length < max) {
    const frame = await source.read();
    if (frame === null) break;
    frames.push(frame);
  }
  return frames;
}

describe("ReplayTelemetrySource", () => {
  it("plays an iRacing slice as replay frames at speed 0", async () => {
    const source = ReplayTelemetrySource.fromFile(IRACING_RACE_START, { speed: 0, loop: false });
    const frames = await drain(source);
    expect(frames.length).toBeGreaterThan(1000);
    expect(frames.every((f) => f.state.source === "replay" && isSimState(f.state))).toBe(true);
    expect(frames.some((f) => f.restart)).toBe(false);
    expect(frames[0]?.state.session.type).toBe("race");
    expect(source.ended).toBe(true);
  });

  it("plays an LMU slice", async () => {
    const source = ReplayTelemetrySource.fromFile(LMU_ON_PACE, { speed: 0, loop: false });
    const frames = await drain(source);
    expect(frames).toHaveLength(49);
    expect(frames.every((f) => f.error === null && f.state.cars.length > 30)).toBe(true);
  });

  it("signals a restart when a looping replay starts over", async () => {
    const source = ReplayTelemetrySource.fromFile(IRACING_SESSION_CHANGE, { speed: 0, loop: true });
    const first = await drain(source, 1);
    expect(first[0]?.restart).toBeUndefined();
    const restarts: number[] = [];
    for (let i = 0; i < 4000 && restarts.length < 2; i++) {
      const f = await source.read();
      if (f?.restart === true) restarts.push(i);
    }
    expect(restarts).toHaveLength(2);
    source.close();
  });

  it("paces frames by the recording's clock", async () => {
    const source = ReplayTelemetrySource.fromFile(LMU_ON_PACE, { speed: 20, loop: false });
    const start = performance.now();
    await drain(source);
    const elapsed = performance.now() - start;
    // 10 s of recording at 20x is about half a second.
    expect(elapsed).toBeGreaterThan(300);
    expect(elapsed).toBeLessThan(5000);
  });
});
