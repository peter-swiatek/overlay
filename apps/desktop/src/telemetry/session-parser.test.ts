import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PARSE_TIMEOUT_MS,
  WorkerSessionParser,
  type SessionJob,
  type SessionJobResult,
  type WorkerLike,
} from "./session-parser";

const YAML = new TextEncoder().encode("WeekendInfo:\n TrackName: Test Ring\n");

class ScriptedWorker implements WorkerLike {
  jobs: SessionJob[] = [];
  terminated = false;
  private onMessage: ((r: SessionJobResult) => void) | undefined;
  private onError: ((e: Error) => void) | undefined;
  postMessage(job: SessionJob): void {
    this.jobs.push(job);
  }
  on(event: string, listener: (arg: never) => void): unknown {
    if (event === "message") this.onMessage = listener as (r: SessionJobResult) => void;
    else this.onError = listener as (e: Error) => void;
    return this;
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answers the newest job as the real worker would. */
  answer(trackName = "Test Ring"): void {
    const job = this.jobs[this.jobs.length - 1] as SessionJob;
    const info = {
      trackName,
      trackLengthM: null,
      pitSpeedLimitMps: null,
      currentSessionNum: null,
      sessions: [],
      driverCarIdx: null,
      fuelCapacityL: null,
      drivers: [],
    };
    this.onMessage?.({ id: job.id, info });
  }
  fail(message: string): void {
    this.onError?.(new Error(message));
  }
}

function setup() {
  const workers: ScriptedWorker[] = [];
  const parser = new WorkerSessionParser(() => {
    const w = new ScriptedWorker();
    workers.push(w);
    return w;
  });
  return { parser, workers };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WorkerSessionParser", () => {
  it("returns the previous info until the new parse finishes", () => {
    const { parser, workers } = setup();
    parser.request(YAML);
    workers[0]?.answer("First");
    expect(parser.latest()?.trackName).toBe("First");
    parser.request(YAML);
    expect(parser.latest()?.trackName).toBe("First");
    workers[0]?.answer("Second");
    expect(parser.latest()?.trackName).toBe("Second");
  });

  it("terminates the worker on close and starts a new one on demand", () => {
    const { parser, workers } = setup();
    parser.request(YAML);
    parser.close();
    expect(workers[0]?.terminated).toBe(true);
    parser.request(YAML);
    expect(workers).toHaveLength(2);
  });

  it("reset clears the running flag so the next request is sent at once", () => {
    const { parser, workers } = setup();
    parser.request(YAML);
    parser.reset();
    parser.request(YAML);
    expect(workers[0]?.jobs).toHaveLength(2);
    expect(parser.latest()).toBeNull();
  });

  it("replaces a hung worker after the timeout and parses again", () => {
    const { parser, workers } = setup();
    parser.request(YAML);
    vi.advanceTimersByTime(PARSE_TIMEOUT_MS + 1);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.jobs).toHaveLength(1);
    workers[1]?.answer("Recovered");
    expect(parser.latest()?.trackName).toBe("Recovered");
    expect(parser.lastError).toContain("timed out");
  });

  it("re-queues the latest YAML after a worker error, with a limited number of tries", () => {
    const { parser, workers } = setup();
    parser.request(YAML);
    workers[0]?.fail("worker died");
    expect(workers).toHaveLength(2);
    expect(workers[1]?.jobs).toHaveLength(1);
    workers[1]?.fail("again");
    workers[2]?.fail("and again");
    // Three tries in all, then it stops instead of looping.
    expect(workers).toHaveLength(3);
    // A new request starts afresh.
    parser.request(YAML);
    expect(workers).toHaveLength(4);
    workers[3]?.answer("Fine");
    expect(parser.latest()?.trackName).toBe("Fine");
  });

  it("prefers newer YAML queued during a failing parse", () => {
    const { parser, workers } = setup();
    parser.request(new TextEncoder().encode("old"));
    parser.request(new TextEncoder().encode("newer"));
    workers[0]?.fail("died");
    const job = workers[1]?.jobs[0];
    expect(new TextDecoder().decode(job?.bytes)).toBe("newer");
  });
});
