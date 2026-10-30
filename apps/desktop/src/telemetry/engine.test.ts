import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Deriver, MockSource, type SimState, type TelemetryFrame } from "@overlay/sim-core";
import { AutoSelector } from "./auto-select";
import { TelemetryEngine } from "./engine";
import type { LiveSource, SourceFrame, TelemetrySource } from "./source";

class FakeLive implements LiveSource {
  live = false;
  probes = 0;
  closed = 0;
  reads = 0;
  readonly pollIntervalMs = 10;
  private readonly mock = new MockSource();
  constructor(readonly id: "iracing" | "lmu") {}
  probe(): boolean {
    this.probes++;
    return this.live;
  }
  async read(): Promise<SourceFrame | null> {
    this.reads++;
    return this.live ? { state: this.mock.step(0.01) } : null;
  }
  close(): void {
    this.closed++;
  }
}

function setup() {
  const iracing = new FakeLive("iracing");
  const lmu = new FakeLive("lmu");
  const frames: TelemetryFrame[] = [];
  const engine = new TelemetryEngine({
    live: { iracing, lmu },
    createReplay: () => {
      throw new Error("no replay in this test");
    },
    createMock: () => new FakeMock(),
    publish: (f) => frames.push(f),
  });
  const last = (): TelemetryFrame | undefined => frames[frames.length - 1];
  const live = (): TelemetryFrame[] => frames.filter((f) => f.status === "live");
  return { iracing, lmu, frames, engine, last, live };
}

class FakeMock implements TelemetrySource {
  readonly id = "mock";
  readonly pollIntervalMs = 16;
  private readonly mock = new MockSource();
  async read(): Promise<SourceFrame | null> {
    return { state: this.mock.step(1 / 60) };
  }
  close(): void {}
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AutoSelector", () => {
  it("keeps the current sim, switches after 5 s not live, prefers iRacing", () => {
    const selector = new AutoSelector();
    const live = { iracing: false, lmu: true };
    const isLive = (s: "iracing" | "lmu"): boolean => live[s];
    expect(selector.update(0, isLive)).toBe("lmu");
    live.iracing = true;
    expect(selector.update(1000, isLive)).toBe("lmu");
    live.lmu = false;
    expect(selector.update(2000, isLive)).toBe("lmu");
    expect(selector.update(6999, isLive)).toBe("lmu");
    expect(selector.update(7000, isLive)).toBe("iracing");
    live.iracing = false;
    expect(selector.update(8000, isLive)).toBe("iracing");
    expect(selector.update(13000, isLive)).toBeNull();
  });

  it("forgets a short outage", () => {
    const selector = new AutoSelector();
    let lmuLive = true;
    const isLive = (s: "iracing" | "lmu"): boolean => s === "lmu" && lmuLive;
    selector.update(0, isLive);
    lmuLive = false;
    selector.update(1000, isLive);
    lmuLive = true;
    selector.update(4000, isLive);
    lmuLive = false;
    selector.update(5000, isLive);
    expect(selector.update(9000, isLive)).toBe("lmu");
    expect(selector.update(10000, isLive)).toBeNull();
  });
});

describe("TelemetryEngine auto-detect", () => {
  it("publishes a waiting frame every second while no sim is live", async () => {
    const { engine, frames } = setup();
    engine.start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames.every((f) => f.status === "waiting" && f.state.connected === false)).toBe(true);
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    engine.stop();
  });

  it("goes live with iRacing within a second, and prefers it when both are live", async () => {
    const { engine, iracing, lmu, live } = setup();
    iracing.live = true;
    lmu.live = true;
    engine.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(live().length).toBeGreaterThan(5);
    expect(live().every((f) => f.source === "iracing")).toBe(true);
    expect(lmu.reads).toBe(0);
    // The idle sim is still probed, so its handles stay current.
    expect(lmu.probes).toBeGreaterThan(0);
    engine.stop();
  });

  it("keeps LMU while it is live even when iRacing appears, then switches after 5 s without it", async () => {
    const { engine, iracing, lmu, last, frames } = setup();
    lmu.live = true;
    engine.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(last()?.source).toBe("lmu");

    iracing.live = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(last()?.source).toBe("lmu");

    lmu.live = false;
    await vi.advanceTimersByTimeAsync(3000);
    // Not live for 3 s so far: still LMU, quiet.
    expect(frames.filter((f) => f.source === "iracing" && f.status === "live")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(last()?.source).toBe("iracing");
    expect(last()?.status).toBe("live");

    iracing.live = false;
    await vi.advanceTimersByTimeAsync(7000);
    expect(last()?.status).toBe("waiting");
    engine.stop();
  });

  it("resets the calculators when the source switches", async () => {
    const reset = vi.spyOn(Deriver.prototype, "reset");
    const { engine, iracing, lmu } = setup();
    iracing.live = true;
    engine.start();
    await vi.advanceTimersByTimeAsync(1500);
    const afterStart = reset.mock.calls.length;
    iracing.live = false;
    lmu.live = true;
    await vi.advanceTimersByTimeAsync(7000);
    expect(reset.mock.calls.length).toBeGreaterThan(afterStart);
    engine.stop();
  });

  it("resets when a source reports a restart, and reports read failures as error frames", async () => {
    const reset = vi.spyOn(Deriver.prototype, "reset");
    const states: SimState[] = [new MockSource().state(), new MockSource().state()];
    let n = 0;
    const source: TelemetrySource = {
      id: "replay",
      pollIntervalMs: 10,
      async read() {
        n++;
        if (n === 4) throw new Error("boom");
        const state = states[n % 2] as SimState;
        return n === 3 ? { state, restart: true } : { state };
      },
      close() {},
    };
    const { frames } = setup();
    const engine = new TelemetryEngine({
      live: {},
      createReplay: () => source,
      createMock: () => source,
      publish: (f) => frames.push(f),
    });
    engine.setSource({ source: "replay", replayPath: "x.ovfx" });
    engine.start();
    const before = reset.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(reset.mock.calls.length).toBe(before + 1);
    const error = frames.find((f) => f.status === "error");
    expect(error?.error).toContain("boom");
    expect(frames.some((f) => f.status === "live")).toBe(true);
    engine.stop();
  });

  it("serves the mock source at about 60 Hz and stops cleanly", async () => {
    const { engine, frames } = setup();
    engine.setSource({ source: "mock" });
    engine.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(frames.length).toBeGreaterThan(50);
    expect(frames.length).toBeLessThanOrEqual(64);
    expect(frames.every((f) => f.status === "live" && f.source === "mock")).toBe(true);
    engine.stop();
    const count = frames.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(frames).toHaveLength(count);
  });

  it("only watches the chosen sim when one is forced", async () => {
    const { engine, iracing, lmu, last } = setup();
    iracing.live = true;
    lmu.live = true;
    engine.setSource({ source: "lmu" });
    engine.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(last()?.source).toBe("lmu");
    expect(iracing.reads).toBe(0);
    engine.stop();
  });
});
