import { describe, expect, it } from "vitest";
import type { TelemetryCommand, TelemetryEvent } from "../shared/telemetry-types";
import {
  RESTART_BASE_MS,
  RESTART_MAX_MS,
  STABLE_UPTIME_MS,
  TelemetryManager,
  restartDelayMs,
  type TelemetryChild,
} from "./telemetry-manager";
import {
  DEFAULT_TELEMETRY_SETTINGS,
  parseTelemetrySettings,
  type TelemetrySettings,
} from "./telemetry-settings";

class FakeChild implements TelemetryChild {
  readonly sent: { message: TelemetryCommand; transfer: unknown[] | undefined }[] = [];
  private readonly listeners = {
    message: [] as ((m: unknown) => void)[],
    exit: [] as (() => void)[],
  };

  postMessage(message: TelemetryCommand, transfer?: unknown[]): void {
    this.sent.push({ message, transfer });
  }
  on(event: "message" | "exit", listener: ((m: unknown) => void) & (() => void)): void {
    this.listeners[event].push(listener);
  }
  kill(): void {}
  emit(message: unknown): void {
    for (const l of this.listeners.message) l(message);
  }
  exit(): void {
    for (const l of this.listeners.exit) l();
  }
  subscribes(): { rateHz: number; port: unknown }[] {
    return this.sent.flatMap((s) =>
      s.message.type === "subscribe" ? [{ rateHz: s.message.rateHz, port: s.transfer?.[0] }] : [],
    );
  }
  commands(type: TelemetryCommand["type"]): TelemetryCommand[] {
    return this.sent.map((s) => s.message).filter((m) => m.type === type);
  }
}

interface Harness {
  manager: TelemetryManager;
  children: FakeChild[];
  posted: { sender: object; port: unknown }[];
  timers: { fn: () => void; ms: number; cancelled: boolean }[];
  settingsChanges: TelemetrySettings[];
  statuses: TelemetryEvent[];
  overlays: Set<object>;
  clock: { now: number };
  window(): object;
}

function harness(initial: Partial<TelemetrySettings> = {}): Harness {
  let stored = parseTelemetrySettings({ ...DEFAULT_TELEMETRY_SETTINGS, ...initial });
  const children: FakeChild[] = [];
  const posted: Harness["posted"] = [];
  const timers: Harness["timers"] = [];
  const settingsChanges: TelemetrySettings[] = [];
  const statuses: TelemetryEvent[] = [];
  const overlays = new Set<object>();
  let portNo = 0;
  const clock = { now: 1000 };
  const manager = new TelemetryManager(
    {
      load: () => stored,
      update: (patch) => (stored = parseTelemetrySettings({ ...stored, ...(patch as object) })),
    },
    {
      fork: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      createChannel: () => {
        portNo += 1;
        return { port1: `port1-${portNo}`, port2: `port2-${portNo}` };
      },
      postPortToRenderer: (sender, port) => posted.push({ sender, port }),
      isOverlaySender: (sender) => overlays.has(sender),
      nowMs: () => clock.now,
      setTimer: (fn, ms) => {
        const timer = { fn, ms, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      onSettingsChange: (s) => settingsChanges.push(s),
      onStatusChange: (status) => statuses.push(status),
    },
  );
  return {
    manager,
    children,
    posted,
    timers,
    settingsChanges,
    statuses,
    overlays,
    clock,
    window: () => {
      const w = {};
      overlays.add(w);
      return w;
    },
  };
}

describe("TelemetryManager", () => {
  it("forks once and sends the stored source on start", () => {
    const h = harness({ source: "replay", replayPath: "C:/r.ovfx", replaySpeed: 4 });
    h.manager.start();
    h.manager.start();
    expect(h.children).toHaveLength(1);
    expect(h.children[0]?.sent[0]?.message).toEqual({
      type: "setSource",
      source: "replay",
      replayPath: "C:/r.ovfx",
      replaySpeed: 4,
    });
  });

  it("sends fuel options on change only and resends them after a restart", () => {
    const h = harness();
    h.manager.start();
    const first = h.children[0] as FakeChild;
    expect(first.commands("setFuelOptions")).toEqual([]);
    h.manager.setFuelOptions({ keepFuelData: true });
    h.manager.setFuelOptions({ keepFuelData: true });
    expect(first.commands("setFuelOptions")).toEqual([
      { type: "setFuelOptions", keepFuelData: true },
    ]);
    h.manager.setFuelOptions({ keepFuelData: false });
    expect(first.commands("setFuelOptions")).toHaveLength(2);
    h.manager.setFuelOptions({ keepFuelData: true });
    first.exit();
    h.timers[0]?.fn();
    const second = h.children[1] as FakeChild;
    expect(second.commands("setFuelOptions")).toEqual([
      { type: "setFuelOptions", keepFuelData: true },
    ]);
    // Sent after the source, before any port.
    expect(second.sent.map((s) => s.message.type).slice(0, 2)).toEqual([
      "setSource",
      "setFuelOptions",
    ]);
  });

  it("sends Setup Compare options when they change and again to a restarted child", () => {
    const h = harness();
    h.manager.setSetupCompareOptions({ pinBaseline: false });
    h.manager.start();
    const first = h.children[0] as FakeChild;
    expect(first.commands("setSetupCompareOptions")).toEqual([
      { type: "setSetupCompareOptions", pinBaseline: false },
    ]);
    h.manager.setSetupCompareOptions({ pinBaseline: false });
    h.manager.setSetupCompareOptions({ pinBaseline: true });
    expect(first.commands("setSetupCompareOptions")).toEqual([
      { type: "setSetupCompareOptions", pinBaseline: false },
      { type: "setSetupCompareOptions", pinBaseline: true },
    ]);
    first.exit();
    h.timers[0]?.fn();
    expect(h.children[1]?.commands("setSetupCompareOptions")).toEqual([
      { type: "setSetupCompareOptions", pinBaseline: true },
    ]);
  });

  it("holds fuel options set before start and sends them with the child", () => {
    const h = harness();
    h.manager.setFuelOptions({ keepFuelData: true });
    expect(h.children).toHaveLength(0);
    h.manager.start();
    expect(h.children[0]?.commands("setFuelOptions")).toEqual([
      { type: "setFuelOptions", keepFuelData: true },
    ]);
  });

  it("omits replayPath when none is set", () => {
    const h = harness();
    h.manager.start();
    expect(h.children[0]?.sent[0]?.message).toEqual({
      type: "setSource",
      source: "auto",
      replaySpeed: 1,
    });
  });

  it("brokers a port pair: port1 to the process, port2 to the window", () => {
    const h = harness();
    h.manager.start();
    const win = h.window();
    expect(h.manager.handleSubscribe(win, 30)).toBe(true);
    expect(h.children[0]?.subscribes()).toEqual([{ rateHz: 30, port: "port1-1" }]);
    expect(h.posted).toEqual([{ sender: win, port: "port2-1" }]);
  });

  it("brokers a new port only for a higher rate", () => {
    const h = harness();
    h.manager.start();
    const win = h.window();
    h.manager.handleSubscribe(win, 10);
    h.manager.handleSubscribe(win, 10);
    h.manager.handleSubscribe(win, 5);
    expect(h.children[0]?.subscribes()).toHaveLength(1);
    h.manager.handleSubscribe(win, 60);
    expect(h.children[0]?.subscribes().map((s) => s.rateHz)).toEqual([10, 60]);
    h.manager.handleSubscribe(win, 20);
    expect(h.children[0]?.subscribes()).toHaveLength(2);
  });

  it("tracks the rate per window", () => {
    const h = harness();
    h.manager.start();
    const a = h.window();
    const b = h.window();
    h.manager.handleSubscribe(a, 60);
    h.manager.handleSubscribe(b, 10);
    expect(h.children[0]?.subscribes().map((s) => s.rateHz)).toEqual([60, 10]);
    expect(h.posted.map((p) => p.sender)).toEqual([a, b]);
  });

  it("clamps the rate to 1..60 and treats garbage as the default", () => {
    const h = harness();
    h.manager.start();
    const [a, b, c, d] = [h.window(), h.window(), h.window(), h.window()];
    h.manager.handleSubscribe(a, 500);
    h.manager.handleSubscribe(b, -3);
    h.manager.handleSubscribe(c, "fast");
    h.manager.handleSubscribe(d, Number.NaN);
    expect(h.children[0]?.subscribes().map((s) => s.rateHz)).toEqual([60, 1, 30, 30]);
  });

  it("rejects senders that are not overlay windows", () => {
    const h = harness();
    h.manager.start();
    expect(h.manager.handleSubscribe({}, 30)).toBe(false);
    expect(h.children[0]?.subscribes()).toHaveLength(0);
    expect(h.posted).toHaveLength(0);
  });

  it("re-brokers every window with a rate when the process restarts", () => {
    const h = harness();
    h.manager.start();
    const a = h.window();
    const b = h.window();
    h.manager.handleSubscribe(a, 60);
    h.manager.handleSubscribe(a, 10);
    h.manager.handleSubscribe(b, 15);
    h.children[0]?.exit();
    expect(h.timers).toHaveLength(1);
    h.timers[0]?.fn();
    const second = h.children[1];
    expect(second?.commands("setSource")).toHaveLength(1);
    expect(second?.subscribes().map((s) => s.rateHz)).toEqual([60, 15]);
    expect(h.posted.slice(-2).map((p) => p.sender)).toEqual([a, b]);
  });

  it("forgets a window on load start or renderer crash, and asks again afterwards", () => {
    const h = harness();
    h.manager.start();
    const win = h.window();
    h.manager.handleSubscribe(win, 30);
    h.manager.forgetWindow(win);
    h.children[0]?.exit();
    h.timers[0]?.fn();
    expect(h.children[1]?.subscribes()).toHaveLength(0);
    // The reloaded page asks again, even at a lower rate than before.
    h.manager.handleSubscribe(win, 10);
    expect(h.children[1]?.subscribes().map((s) => s.rateHz)).toEqual([10]);
  });

  it("does not broker while no process runs, but remembers the rate", () => {
    const h = harness();
    h.manager.start();
    const win = h.window();
    h.children[0]?.exit();
    expect(h.manager.handleSubscribe(win, 20)).toBe(false);
    h.timers[0]?.fn();
    expect(h.children[1]?.subscribes().map((s) => s.rateHz)).toEqual([20]);
  });

  it("backs off while the process keeps crashing, even if it reports a status first", () => {
    const h = harness();
    h.manager.start();
    h.children[0]?.exit();
    h.timers[0]?.fn();
    h.children[1]?.emit({ type: "status", status: "live", source: "mock", error: null });
    h.clock.now += 1000;
    h.children[1]?.exit();
    h.timers[1]?.fn();
    h.children[2]?.exit();
    expect(h.timers.map((t) => t.ms)).toEqual([
      RESTART_BASE_MS,
      RESTART_BASE_MS * 2,
      RESTART_BASE_MS * 4,
    ]);
  });

  it("resets the delay once the process stayed up long enough", () => {
    const h = harness();
    h.manager.start();
    h.children[0]?.exit();
    h.timers[0]?.fn();
    h.children[1]?.exit();
    h.timers[1]?.fn();
    h.clock.now += STABLE_UPTIME_MS;
    h.children[2]?.exit();
    expect(h.timers.map((t) => t.ms)).toEqual([
      RESTART_BASE_MS,
      RESTART_BASE_MS * 2,
      RESTART_BASE_MS,
    ]);
  });

  it("caps the restart delay", () => {
    expect(restartDelayMs(0)).toBe(RESTART_BASE_MS);
    expect(restartDelayMs(50)).toBe(RESTART_MAX_MS);
  });

  it("stops restarting after shutdown, which sends stop", () => {
    const h = harness();
    h.manager.start();
    h.children[0]?.exit();
    expect(h.timers).toHaveLength(1);
    h.manager.shutdown();
    expect(h.timers[0]?.cancelled).toBe(true);

    const h2 = harness();
    h2.manager.start();
    h2.manager.shutdown();
    expect(h2.children[0]?.commands("stop")).toHaveLength(1);
    h2.children[0]?.exit();
    // No restart timer; the only timer was the shutdown wait, which the exit cancelled.
    expect(h2.timers.filter((t) => !t.cancelled)).toHaveLength(0);
    h2.manager.start();
    expect(h2.children).toHaveLength(1);
    expect(h2.manager.handleSubscribe(h2.window(), 30)).toBe(false);
  });

  it("shutdown waits for the process to exit, or kills it after the timeout", async () => {
    const h = harness();
    h.manager.start();
    const child = h.children[0] as FakeChild;
    let settled = false;
    const done = h.manager.shutdown().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.commands("stop")).toHaveLength(1);
    child.exit();
    await done;
    expect(settled).toBe(true);
    expect(h.timers.at(-1)?.cancelled).toBe(true);

    const h2 = harness();
    h2.manager.start();
    const stuck = h2.children[0] as FakeChild;
    let killed = 0;
    stuck.kill = () => void killed++;
    const waiting = h2.manager.shutdown(3000);
    const timer = h2.timers.at(-1);
    expect(timer?.ms).toBe(3000);
    timer?.fn();
    await waiting;
    expect(killed).toBe(1);

    // Nothing running: resolves at once.
    await expect(harness().manager.shutdown()).resolves.toBeUndefined();
  });

  it("applies settings changes: persists, sends setSource and notifies", () => {
    const h = harness();
    h.manager.start();
    const next = h.manager.updateSettings({ source: "replay", replayPath: "D:/x.ovfx" });
    expect(next).toMatchObject({ source: "replay", replayPath: "D:/x.ovfx" });
    expect(h.manager.getSettings()).toEqual(next);
    expect(h.children[0]?.commands("setSource").at(-1)).toMatchObject({
      source: "replay",
      replayPath: "D:/x.ovfx",
    });
    expect(h.settingsChanges).toEqual([next]);
  });

  it("keeps Replay selected when the file is missing (the process reports the error)", () => {
    const h = harness({ source: "replay", replayPath: "Z:/gone.ovfx" });
    h.manager.start();
    expect(h.manager.getSettings().source).toBe("replay");
    expect(h.children[0]?.commands("setSource")[0]).toMatchObject({ source: "replay" });
  });

  it("keeps the latest status from the process", () => {
    const h = harness();
    h.manager.start();
    h.children[0]?.emit({ type: "status", status: "error", source: "replay", error: "no file" });
    expect(h.manager.getStatus()?.error).toBe("no file");
    h.children[0]?.exit();
    expect(h.manager.getStatus()).toBeUndefined();
  });

  it("reports each status message but not an exit", () => {
    const h = harness();
    h.manager.start();
    h.children[0]?.emit({ type: "status", status: "waiting", source: null, error: null });
    h.children[0]?.emit({ type: "status", status: "live", source: "mock", error: null });
    h.children[0]?.emit({ type: "unrelated" });
    h.children[0]?.exit();
    expect(h.statuses.map((s) => s.status)).toEqual(["waiting", "live"]);
  });
});
