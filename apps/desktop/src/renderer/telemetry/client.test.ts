import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import {
  TelemetryClient,
  isFrame,
  structurallyEqual,
  type ClientPort,
  type PortMessageEvent,
} from "./client";

class FakePort implements ClientPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  readonly posted: unknown[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  close(): void {
    this.closed = true;
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const SELF = { name: "self" };

function frame(seq: number, patch: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    seq,
    source: "mock",
    status: "live",
    error: null,
    state: emptySimState("mock"),
    derived: {
      fuel: null,
      gaps: [],
      track: {
        trackKey: null,
        outlineReady: false,
        pitExitLapDistPct: null,
        pitExitDistanceM: null,
      },
      standings: null,
      proximity: null,
      delta: null,
      slowCar: null,
      energy: null,
    },
    ...patch,
  };
}

function setup() {
  let now = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  let handler: ((event: PortMessageEvent) => void) | undefined;
  const requests: number[] = [];
  const client = new TelemetryClient({
    self: SELF,
    listen: (h) => {
      handler = h;
      return () => {};
    },
    requestSubscribe: (hz) => requests.push(hz),
    nowMs: () => now,
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
  return {
    client,
    requests,
    // Moves the clock, firing due timers on the way (in time order).
    advance: (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false;
        now = Math.max(now, due.at);
        due.fn();
      }
      now = end;
    },
    deliverPort: (
      port: FakePort,
      source: unknown = SELF,
      data: unknown = { type: "telemetry-port" },
    ) => handler?.({ source, data, ports: [port] }),
  };
}

describe("TelemetryClient", () => {
  it("acks each frame after storing it", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    port.receive(frame(1));
    expect(t.client.latest()?.seq).toBe(1);
    expect(port.posted).toEqual([{ type: "ack", seq: 1 }]);
    port.receive(frame(2));
    expect(port.posted).toEqual([
      { type: "ack", seq: 1 },
      { type: "ack", seq: 2 },
    ]);
  });

  it("stores the frame before the ack leaves", () => {
    const t = setup();
    const port = new FakePort();
    let seenAtAck: number | undefined;
    port.postMessage = () => {
      seenAtAck = t.client.latest()?.seq;
    };
    t.deliverPort(port);
    port.receive(frame(7));
    expect(seenAtAck).toBe(7);
  });

  it("accepts a lower seq (the process restarted)", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    port.receive(frame(900));
    port.receive(frame(1));
    expect(t.client.latest()?.seq).toBe(1);
    expect(port.posted.at(-1)).toEqual({ type: "ack", seq: 1 });
  });

  it("closes the old port when a new one arrives and ignores it afterwards", () => {
    const t = setup();
    const a = new FakePort();
    const b = new FakePort();
    t.deliverPort(a);
    t.deliverPort(b);
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
    a.receive(frame(5));
    expect(t.client.latest()).toBeNull();
    expect(a.posted).toHaveLength(0);
    b.receive(frame(1));
    expect(t.client.latest()?.seq).toBe(1);
  });

  it("only accepts port messages that come from the page itself with the right type", () => {
    const t = setup();
    const evil = new FakePort();
    t.deliverPort(evil, { name: "other frame" });
    t.deliverPort(evil, SELF, { type: "something-else" });
    t.deliverPort(evil, SELF, null);
    evil.receive(frame(1));
    expect(t.client.latest()).toBeNull();
    expect(evil.closed).toBe(false);
  });

  it("drops malformed frames without acking", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    port.receive({ seq: 1 });
    port.receive("junk");
    expect(t.client.latest()).toBeNull();
    expect(port.posted).toHaveLength(0);
  });

  it("requests a port on the first subscriber and again only for a higher rate", () => {
    const t = setup();
    const off = t.client.select(
      (f) => f?.seq ?? 0,
      10,
      () => {},
    );
    t.client.select(
      (f) => f?.seq ?? 0,
      10,
      () => {},
    );
    t.client.select(
      (f) => f?.seq ?? 0,
      5,
      () => {},
    );
    expect(t.requests).toEqual([10]);
    t.client.select(
      (f) => f?.seq ?? 0,
      60,
      () => {},
    );
    expect(t.requests).toEqual([10, 60]);
    off();
    t.client.select(
      (f) => f?.seq ?? 0,
      20,
      () => {},
    );
    expect(t.requests).toEqual([10, 60]);
  });

  it("limits each subscriber to its own rate", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    const slow: number[] = [];
    const fast: number[] = [];
    t.client.select(
      (f) => f?.seq ?? 0,
      10,
      (v) => slow.push(v),
    );
    t.client.select(
      (f) => f?.seq ?? 0,
      60,
      (v) => fast.push(v),
    );
    for (let seq = 1; seq <= 12; seq++) {
      port.receive(frame(seq));
      t.advance(1000 / 60);
    }
    expect(fast).toHaveLength(12);
    expect(slow.length).toBeGreaterThanOrEqual(2);
    expect(slow.length).toBeLessThanOrEqual(3);
  });

  it("delivers the last change of a throttled interval as a trailing update", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    const seen: string[] = [];
    t.client.select(
      (f) => f?.status ?? "none",
      10,
      (v) => seen.push(v),
    );
    port.receive(frame(1));
    t.advance(50);
    port.receive(frame(2, { status: "waiting" }));
    expect(seen).toEqual(["live"]);
    t.advance(60);
    expect(seen).toEqual(["live", "waiting"]);
  });

  it("reports stale after 2 s without frames and recovers on the next one", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    const seen: string[] = [];
    t.client.select(
      (f, stale) => (stale ? "stale" : (f?.status ?? "none")),
      60,
      (v) => seen.push(v),
    );
    port.receive(frame(1));
    t.advance(1900);
    expect(seen).toEqual(["live"]);
    t.advance(200);
    expect(seen).toEqual(["live", "stale"]);
    expect(t.client.isStale()).toBe(true);
    port.receive(frame(1));
    expect(seen).toEqual(["live", "stale", "live"]);
    expect(t.client.isStale()).toBe(false);
  });

  it("is never stale before the first frame", () => {
    const t = setup();
    t.advance(10_000);
    expect(t.client.isStale()).toBe(false);
  });

  it("calls back only when the selected value changed", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    const seen: string[] = [];
    t.client.select(
      (f) => ({ status: f?.status ?? "none" }),
      60,
      (v) => seen.push(v.status),
    );
    port.receive(frame(1));
    t.advance(20);
    port.receive(frame(2));
    t.advance(20);
    port.receive(frame(3, { status: "waiting" }));
    expect(seen).toEqual(["live", "waiting"]);
  });

  it("gives a late subscriber the current frame at once", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    port.receive(frame(4));
    const seen: number[] = [];
    t.client.select(
      (f) => f?.seq ?? 0,
      10,
      (v) => seen.push(v),
    );
    expect(seen).toEqual([4]);
  });

  it("stops calling an unsubscribed listener", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    const seen: number[] = [];
    const off = t.client.select(
      (f) => f?.seq ?? 0,
      60,
      (v) => seen.push(v),
    );
    port.receive(frame(1));
    off();
    t.advance(100);
    port.receive(frame(2));
    expect(seen).toEqual([1]);
  });

  it("selectors see waiting frames with an empty state, so they must check status first", () => {
    const t = setup();
    const port = new FakePort();
    t.deliverPort(port);
    const seen: (number | null)[] = [];
    t.client.select(
      (f) => (f && f.status === "live" ? f.state.player.speedMps : null),
      60,
      (v) => seen.push(v),
    );
    port.receive(frame(1, { status: "waiting" }));
    expect(seen).toEqual([null]);
  });
});

describe("isFrame / structurallyEqual", () => {
  it("validates the fields the overlays read", () => {
    expect(isFrame(frame(1))).toBe(true);
    expect(isFrame({ ...frame(1), status: "odd" })).toBe(false);
    expect(isFrame({ ...frame(1), state: null })).toBe(false);
    expect(isFrame(null)).toBe(false);
  });

  it("compares values structurally", () => {
    expect(structurallyEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
    expect(structurallyEqual([{ a: 1 }], [{ a: 2 }])).toBe(false);
    expect(structurallyEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(structurallyEqual([], {})).toBe(false);
    expect(structurallyEqual(null, null)).toBe(true);
  });
});
