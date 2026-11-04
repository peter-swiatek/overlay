import { afterEach, describe, expect, it, vi } from "vitest";
import { Deriver, isSimState, type TrackOutline, type TrackOutlineStore } from "@overlay/sim-core";
import type { TelemetryEvent } from "../shared/telemetry-types";
import { MockTelemetrySource } from "./mock";
import { ReplayTelemetrySource } from "./replay";
import { TelemetryService } from "./service";
import { FakePort, IRACING_RACE_START, outlineFor } from "./testing";

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

  it("passes setFuelOptions to the deriver", () => {
    const deriver = new Deriver();
    const spy = vi.spyOn(deriver, "setKeepFuelData");
    const service = new TelemetryService({
      live: {},
      createReplay: (path, speed, loop) => ReplayTelemetrySource.fromFile(path, { speed, loop }),
      createMock: () => new MockTelemetrySource(),
      monoMs: () => performance.now(),
      sendToMain: () => {},
      onStopped: () => {},
      deriver,
    });
    service.handle({ type: "setFuelOptions", keepFuelData: true }, []);
    service.handle({ type: "setFuelOptions", keepFuelData: false }, []);
    expect(spy.mock.calls).toEqual([[true], [false]]);
  });

  describe("track outlines", () => {
    const KEY = "iracing_virginia-international-raceway_full-course";

    function serviceWithStore(stored: TrackOutline | null) {
      const store: TrackOutlineStore = {
        load: (key) => (stored !== null && key === stored.trackKey ? stored : null),
        save: () => {},
      };
      const service = new TelemetryService({
        live: {},
        createReplay: (path, speed, loop) => ReplayTelemetrySource.fromFile(path, { speed, loop }),
        createMock: () => new MockTelemetrySource(),
        monoMs: () => performance.now(),
        sendToMain: () => {},
        onStopped: () => {},
        deriver: new Deriver({ trackOutlines: store }),
      });
      return service;
    }

    const replies = (port: FakePort): unknown[] =>
      (port.sent as unknown[]).filter((m) => (m as { type?: string }).type === "trackOutline");

    it("answers getTrackOutline with the cached outline, outside the frames", async () => {
      const stored = outlineFor(KEY, 5217);
      const service = serviceWithStore(stored);
      const port = new FakePort();
      port.autoAck = true;
      service.handle(
        { type: "setSource", source: "replay", replayPath: IRACING_RACE_START, replaySpeed: 4 },
        [],
      );
      service.handle({ type: "subscribe", rateHz: 60 }, [port]);
      // Before any frame the track is unknown: no outline.
      port.raw({ type: "getTrackOutline", requestId: 1 });
      service.start();
      await new Promise((r) => setTimeout(r, 1200));
      port.raw({ type: "getTrackOutline", requestId: "two" });
      // A request without an id still gets an answer, with a null id and no outline.
      port.raw({ type: "getTrackOutline" });
      port.raw({ type: "somethingElse", requestId: 3 });
      // A request for another track gets none; one for this track gets it.
      port.raw({ type: "getTrackOutline", requestId: 4, trackKey: "lmu_elsewhere" });
      port.raw({ type: "getTrackOutline", requestId: 5, trackKey: KEY });
      service.handle({ type: "stop" }, []);

      expect(replies(port)).toEqual([
        { type: "trackOutline", requestId: 1, outline: null },
        { type: "trackOutline", requestId: "two", outline: stored },
        { type: "trackOutline", requestId: null, outline: null },
        { type: "trackOutline", requestId: 4, outline: null },
        { type: "trackOutline", requestId: 5, outline: stored },
      ]);
      // Frames carry the key and the flag, never the outline.
      const frames = port.sent.filter((m) => (m as { seq?: unknown }).seq !== undefined);
      const last = frames[frames.length - 1];
      expect(last?.derived.track).toMatchObject({ trackKey: KEY, outlineReady: true });
      expect(JSON.stringify(last)).not.toContain('"points"');
      // The reply does not disturb the frame sequence.
      expect(port.seqs.filter((s) => s !== undefined)).toEqual(
        [...port.seqs.filter((s) => s !== undefined)].sort((a, b) => a - b),
      );
    });

    it("answers null when the track has no outline", async () => {
      const service = serviceWithStore(null);
      const port = new FakePort();
      port.autoAck = true;
      service.handle(
        { type: "setSource", source: "replay", replayPath: IRACING_RACE_START, replaySpeed: 4 },
        [],
      );
      service.handle({ type: "subscribe", rateHz: 60 }, [port]);
      service.start();
      await new Promise((r) => setTimeout(r, 800));
      port.raw({ type: "getTrackOutline", requestId: 9 });
      service.handle({ type: "stop" }, []);
      expect(replies(port)).toEqual([{ type: "trackOutline", requestId: 9, outline: null }]);
      const frames = port.sent.filter((m) => (m as { seq?: unknown }).seq !== undefined);
      expect(frames[frames.length - 1]?.derived.track).toEqual({
        trackKey: KEY,
        outlineReady: false,
        pitExitLapDistPct: null,
        pitExitDistanceM: null,
      });
    });
  });
});
