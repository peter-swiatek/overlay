import { afterEach, describe, expect, it, vi } from "vitest";
import { isSimState } from "@overlay/sim-core";
import type { TelemetryEvent } from "../shared/telemetry-types";
import { MockTelemetrySource } from "./mock";
import { ReplayTelemetrySource } from "./replay";
import { TelemetryService } from "./service";
import { FakePort, IRACING_RACE_START } from "./testing";

function makeService() {
  const events: TelemetryEvent[] = [];
  const stopped = vi.fn();
  const service = new TelemetryService({
    live: {},
    createReplay: (path, speed, loop) => ReplayTelemetrySource.fromFile(path, { speed, loop }),
    createMock: () => new MockTelemetrySource(),
    monoMs: () => performance.now(),
    sendToMain: (e) => events.push(e),
    onStopped: stopped,
  });
  return { service, events, stopped };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TelemetryService", () => {
  it("streams the mock source to a subscriber at its rate, with growing seq", async () => {
    const { service, events } = makeService();
    const port = new FakePort();
    port.autoAck = true;
    service.handle({ type: "setSource", source: "mock" }, []);
    service.handle({ type: "subscribe", rateHz: 10 }, [port]);
    service.start();
    await new Promise((r) => setTimeout(r, 1100));
    service.handle({ type: "stop" }, []);

    expect(port.started).toBe(true);
    expect(port.sent.length).toBeGreaterThanOrEqual(8);
    expect(port.sent.length).toBeLessThanOrEqual(13);
    expect(port.sent.every((f) => f.status === "live" && isSimState(f.state))).toBe(true);
    const seqs = port.seqs;
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(events[0]).toEqual({ type: "status", status: "live", source: "mock", error: null });
  });

  it("replays a recording end to end through the engine and publisher", async () => {
    const { service } = makeService();
    const port = new FakePort();
    port.autoAck = true;
    service.handle(
      { type: "setSource", source: "replay", replayPath: IRACING_RACE_START, replaySpeed: 4 },
      [],
    );
    service.handle({ type: "subscribe", rateHz: 60 }, [port]);
    service.start();
    await new Promise((r) => setTimeout(r, 1500));
    service.handle({ type: "stop" }, []);

    expect(port.sent.length).toBeGreaterThan(30);
    const last = port.sent[port.sent.length - 1];
    expect(last?.source).toBe("replay");
    expect(last?.state.cars.length).toBeGreaterThan(10);
    expect(last?.derived.gaps.length).toBeGreaterThan(5);
    expect(last?.derived.fuel).not.toBeNull();
  });

  it("drops a subscriber whose port closes and keeps serving the others", async () => {
    const { service } = makeService();
    const a = new FakePort();
    const b = new FakePort();
    a.autoAck = b.autoAck = true;
    service.handle({ type: "setSource", source: "mock" }, []);
    service.handle({ type: "subscribe", rateHz: 30 }, [a]);
    service.handle({ type: "subscribe", rateHz: 30 }, [b]);
    service.start();
    await new Promise((r) => setTimeout(r, 300));
    a.close();
    const countA = a.sent.length;
    await new Promise((r) => setTimeout(r, 300));
    service.handle({ type: "stop" }, []);
    expect(a.sent.length).toBe(countA);
    expect(b.sent.length).toBeGreaterThan(countA);
    expect(service.publisher.subscriberCount).toBe(1);
  });

  it("ignores a subscribe without a port and calls onStopped on stop", () => {
    const { service, stopped } = makeService();
    service.handle({ type: "subscribe", rateHz: 30 }, []);
    expect(service.publisher.subscriberCount).toBe(0);
    service.handle({ type: "stop" }, []);
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("is waiting, not failing, when no live sim exists (Linux, no sim running)", async () => {
    vi.useFakeTimers();
    const { service, events } = makeService();
    const port = new FakePort();
    service.handle({ type: "subscribe", rateHz: 60 }, [port]);
    service.start();
    await vi.advanceTimersByTimeAsync(2500);
    service.handle({ type: "stop" }, []);
    expect(port.sent.length).toBeGreaterThan(0);
    expect(port.sent.every((f) => f.status === "waiting")).toBe(true);
    expect(events).toEqual([{ type: "status", status: "waiting", source: null, error: null }]);
  });
});
