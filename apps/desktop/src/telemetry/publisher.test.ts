import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDerived, emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { TelemetryPublisher } from "./publisher";
import { FakePort } from "./testing";

function frame(seq: number): TelemetryFrame {
  return {
    seq,
    source: "mock",
    status: "live",
    error: null,
    state: emptySimState("mock"),
    derived: emptyDerived(),
  };
}

describe("TelemetryPublisher", () => {
  it("starts the port and drops the subscriber on close", () => {
    const publisher = new TelemetryPublisher();
    const port = new FakePort();
    publisher.addSubscriber(port, 30);
    expect(port.started).toBe(true);
    expect(publisher.subscriberCount).toBe(1);
    port.close();
    expect(publisher.subscriberCount).toBe(0);
    publisher.publish(frame(1), 0);
    expect(port.sent).toEqual([]);
  });

  it("throttles each subscriber to its own rate", () => {
    const publisher = new TelemetryPublisher();
    const slow = new FakePort();
    const fast = new FakePort();
    publisher.addSubscriber(slow, 10);
    publisher.addSubscriber(fast, 60);
    // One second of frames at about 120 Hz; the renderers ack at once.
    for (let i = 0; i < 120; i++) {
      publisher.publish(frame(i + 1), i * (1000 / 120));
      slow.ack(i + 1);
      fast.ack(i + 1);
    }
    expect(slow.sent.length).toBeGreaterThanOrEqual(9);
    expect(slow.sent.length).toBeLessThanOrEqual(11);
    expect(fast.sent.length).toBeGreaterThanOrEqual(58);
    expect(fast.sent.length).toBeLessThanOrEqual(62);
  });

  it("clamps the rate to 1..60 Hz", () => {
    const publisher = new TelemetryPublisher();
    const tooFast = new FakePort();
    const tooSlow = new FakePort();
    publisher.addSubscriber(tooFast, 1000);
    publisher.addSubscriber(tooSlow, 0);
    for (let i = 0; i < 2000; i++) {
      publisher.publish(frame(i + 1), i);
      tooFast.ack(i + 1);
      tooSlow.ack(i + 1);
    }
    // 2 s of 1 kHz frames: at most 60 Hz and at least 1 Hz.
    expect(tooFast.sent.length).toBeLessThanOrEqual(122);
    expect(tooFast.sent.length).toBeGreaterThan(100);
    expect(tooSlow.sent.length).toBeLessThanOrEqual(3);
    expect(tooSlow.sent.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps only the latest frame while two are unacknowledged", () => {
    const publisher = new TelemetryPublisher();
    const port = new FakePort();
    publisher.addSubscriber(port, 60);
    for (let i = 1; i <= 6; i++) publisher.publish(frame(i), i * 20);
    expect(port.seqs).toEqual([1, 2]);
    port.ack(1);
    // The latest waiting frame (6), not 3, 4 or 5.
    expect(port.seqs).toEqual([1, 2, 6]);
    port.ack(2);
    expect(port.seqs).toEqual([1, 2, 6]);
    port.ack(6);
    publisher.publish(frame(7), 400);
    expect(port.seqs).toEqual([1, 2, 6, 7]);
  });

  it("does not let one slow subscriber hold back another", () => {
    const publisher = new TelemetryPublisher();
    const stuck = new FakePort();
    const fine = new FakePort();
    publisher.addSubscriber(stuck, 60);
    publisher.addSubscriber(fine, 60);
    for (let i = 1; i <= 10; i++) {
      publisher.publish(frame(i), i * 20);
      fine.ack(i);
    }
    expect(stuck.sent).toHaveLength(2);
    expect(fine.sent).toHaveLength(10);
  });

  it("ignores messages that are not acks", () => {
    const publisher = new TelemetryPublisher();
    const port = new FakePort();
    publisher.addSubscriber(port, 60);
    publisher.publish(frame(1), 0);
    publisher.publish(frame(2), 20);
    publisher.publish(frame(3), 40);
    expect(port.seqs).toEqual([1, 2]);
    for (const junk of [
      null,
      "ack",
      { type: "nope", seq: 1 },
      { type: "ack" },
      { type: "ack", seq: "1" },
    ]) {
      port.raw(junk);
    }
    expect(port.seqs).toEqual([1, 2]);
    port.ack(2);
    expect(port.seqs).toEqual([1, 2, 3]);
  });

  describe("held frames", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends the newest throttled frame when the rate window opens", async () => {
      vi.useFakeTimers();
      const publisher = new TelemetryPublisher(() => Date.now());
      const port = new FakePort();
      publisher.addSubscriber(port, 1);
      publisher.publish(frame(1), Date.now());
      port.ack(1);
      // Within the one-second window: held, not lost, and only the newest survives.
      vi.advanceTimersByTime(100);
      publisher.publish(frame(2), Date.now());
      publisher.publish(frame(3), Date.now());
      expect(port.seqs).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(port.seqs).toEqual([1, 3]);
    });

    it("always delivers a changed status, even inside the rate window", () => {
      vi.useFakeTimers();
      const publisher = new TelemetryPublisher(() => Date.now());
      const port = new FakePort();
      publisher.addSubscriber(port, 1);
      publisher.publish(frame(1), Date.now());
      port.ack(1);
      publisher.publish({ ...frame(2), status: "waiting" }, Date.now());
      expect(port.seqs).toEqual([1, 2]);
      port.ack(2);
      publisher.publish({ ...frame(3), status: "error", error: "boom" }, Date.now());
      expect(port.seqs).toEqual([1, 2, 3]);
      port.ack(3);
      // Same status and error again: throttled as usual.
      publisher.publish({ ...frame(4), status: "error", error: "boom" }, Date.now());
      expect(port.seqs).toEqual([1, 2, 3]);
      // A different error text is a change.
      publisher.publish({ ...frame(5), status: "error", error: "other" }, Date.now());
      expect(port.seqs).toEqual([1, 2, 3, 5]);
    });

    it("keeps a changed-status frame for the next ack when two frames are unacked", () => {
      vi.useFakeTimers();
      const publisher = new TelemetryPublisher(() => Date.now());
      const port = new FakePort();
      publisher.addSubscriber(port, 60);
      publisher.publish(frame(1), Date.now());
      vi.advanceTimersByTime(20);
      publisher.publish(frame(2), Date.now());
      vi.advanceTimersByTime(20);
      publisher.publish({ ...frame(3), status: "waiting" }, Date.now());
      expect(port.seqs).toEqual([1, 2]);
      port.ack(1);
      expect(port.seqs).toEqual([1, 2, 3]);
    });

    it("does not send a held frame after the port closed", async () => {
      vi.useFakeTimers();
      const publisher = new TelemetryPublisher(() => Date.now());
      const port = new FakePort();
      publisher.addSubscriber(port, 1);
      publisher.publish(frame(1), Date.now());
      port.ack(1);
      publisher.publish(frame(2), Date.now());
      port.close();
      await vi.advanceTimersByTimeAsync(2000);
      expect(port.seqs).toEqual([1]);
    });
  });
});

describe("TelemetryPublisher requests", () => {
  it("hands messages that are not acks to the handler and never the acks", () => {
    const publisher = new TelemetryPublisher();
    const port = new FakePort();
    const seen: unknown[] = [];
    publisher.addSubscriber(port, 30, (data) => seen.push(data));
    port.ack(1);
    port.raw({ type: "getTrackOutline", requestId: 7 });
    port.raw("junk");
    expect(seen).toEqual([{ type: "getTrackOutline", requestId: 7 }, "junk"]);
  });

  it("sends a reply at once, outside the rate limit and the ack window", () => {
    const publisher = new TelemetryPublisher();
    const port = new FakePort();
    publisher.addSubscriber(port, 1, (_data, reply) =>
      reply({ type: "trackOutline", requestId: 1 }),
    );
    // Two frames go out and stay unacknowledged: the subscriber now holds back further frames.
    publisher.publish(frame(1), 0);
    publisher.publish(frame(2), 1000);
    publisher.publish(frame(3), 2000);
    expect(port.seqs).toEqual([1, 2]);
    port.raw({ type: "getTrackOutline", requestId: 1 });
    expect(port.sent).toHaveLength(3);
    expect(port.sent[2]).toEqual({ type: "trackOutline", requestId: 1 });
  });

  it("does not reply on a closed port", () => {
    const publisher = new TelemetryPublisher();
    const port = new FakePort();
    let reply: ((m: unknown) => void) | undefined;
    publisher.addSubscriber(port, 30, (_d, r) => (reply = r));
    port.raw({});
    port.close();
    reply?.({ type: "late" });
    expect(port.sent).toEqual([]);
  });
});
