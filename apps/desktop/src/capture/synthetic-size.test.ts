import { Writable } from "node:stream";
import { FixtureWriter, RecordKind } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import { FakeClock } from "./fakes";

class CountingSink extends Writable {
  bytes = 0;
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.bytes += chunk.length;
    cb();
  }
}

/** A mostly-zero 327,680-byte buffer with a few hundred changing doubles and floats. */
function syntheticFrame(frame: number, scratch: Buffer): Buffer {
  scratch.fill(0);
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // Header/session area: static text.
  scratch.write("Le Mans Ultimate synthetic track name", 400, "latin1");
  // 30 cars x 20 live doubles: positions, speeds, times.
  for (let car = 0; car < 30; car++) {
    const base = 2000 + car * 584;
    for (let i = 0; i < 20; i++) {
      scratch.writeDoubleLE(100 * car + frame * 0.2 * (i + 1) + rand() * 0.01, base + i * 8);
    }
  }
  // Player telemetry: 100 floats with noise in the low bits.
  for (let i = 0; i < 100; i++) scratch.writeFloatLE(rand() * 100 + frame, 130_000 + i * 4);
  return scratch;
}

describe("LMU frame compression", () => {
  it("reports compressed MB/min at 5 Hz for a synthetic buffer", async () => {
    const sink = new CountingSink();
    const writer = new FixtureWriter(
      sink,
      { sim: "lmu", captureToolVersion: "1", appVersion: "0", os: "t", startedUtc: "", notes: "" },
      { clock: new FakeClock() },
    );
    const scratch = Buffer.alloc(327_680);
    const frames = 300; // one minute at 5 Hz
    for (let i = 0; i < frames; i++) {
      await writer.write(RecordKind.LmuBuffer, syntheticFrame(i, scratch));
    }
    await writer.close();
    const mbPerMin = sink.bytes / (1024 * 1024);
    console.info(`LMU synthetic: ${mbPerMin.toFixed(2)} MB compressed per minute at 5 Hz`);
    expect(mbPerMin).toBeGreaterThan(0);
    expect(mbPerMin).toBeLessThan(60);
  });
});
