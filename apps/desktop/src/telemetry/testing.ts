import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FixtureReader,
  OUTLINE_POINTS,
  RecordKind,
  type FixtureRecord,
  type TrackOutline,
} from "@overlay/sim-core";
import type { TelemetryFrame } from "@overlay/sim-core";
import { FakeMapping } from "../capture/fakes";
import type { PortLike } from "./publisher";

/** Test helpers: committed slices and in-memory sim shared memory built from them. */

export const FIXTURES = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));
export const IRACING_RACE_START = `${FIXTURES}iracing-ferrari-race-start-20s.ovfx`;
export const IRACING_SESSION_CHANGE = `${FIXTURES}iracing-ferrari-quali-to-race-10s.ovfx`;
export const LMU_ON_PACE = `${FIXTURES}lmu-hypercar-onpace-10s-5hz.ovfx`;

export async function readRecords(path: string): Promise<FixtureRecord[]> {
  const records: FixtureRecord[] = [];
  for await (const record of new FixtureReader(createReadStream(path)).records()) {
    records.push(record);
  }
  return records;
}

/** Fake irsdk memory: header, var table, one YAML area and one var buffer (index 0). */
export class FakeIrsdk {
  readonly mapping: FakeMapping;
  private readonly headerLength: number;
  private readonly yamlOffset: number;
  private readonly bufOffset: number;
  private readonly bufLen: number;
  private tick = 0;

  constructor(
    headerBytes: Uint8Array,
    private readonly yamlCapacity = 128 * 1024,
  ) {
    const header = Buffer.from(headerBytes);
    this.headerLength = header.length;
    this.bufLen = header.readInt32LE(36);
    this.yamlOffset = this.headerLength;
    this.bufOffset = this.yamlOffset + yamlCapacity;
    const data = Buffer.alloc(this.bufOffset + this.bufLen);
    header.copy(data);
    data.writeInt32LE(1, 4); // connected
    data.writeInt32LE(60, 8);
    data.writeInt32LE(1, 12); // session info update
    data.writeInt32LE(0, 16);
    data.writeInt32LE(this.yamlOffset, 20);
    data.writeInt32LE(1, 32); // numBuf
    data.writeInt32LE(this.bufOffset, 48 + 4);
    this.mapping = new FakeMapping(data);
  }

  setYaml(yaml: Uint8Array): void {
    const data = this.mapping.data;
    data.fill(0, this.yamlOffset, this.yamlOffset + this.yamlCapacity);
    Buffer.from(yaml).copy(data, this.yamlOffset);
    data.writeInt32LE(yaml.length, 16);
    data.writeInt32LE(data.readInt32LE(12) + 1, 12);
  }

  /** Publishes a var buffer (without the u32 tick that fixture records start with). */
  setVars(varBuffer: Uint8Array, tick = ++this.tick): void {
    const data = this.mapping.data;
    Buffer.from(varBuffer).copy(data, this.bufOffset, 0, this.bufLen);
    data.writeInt32LE(tick, 48);
  }

  setConnected(connected: boolean): void {
    this.mapping.data.writeInt32LE(connected ? 1 : 0, 4);
  }

  bumpTickInPlace(tick: number): void {
    this.mapping.data.writeInt32LE(tick, 48);
  }
}

export { RecordKind };

/** A MessagePort stand-in that records what the publisher sends. */
export class FakePort implements PortLike {
  sent: TelemetryFrame[] = [];
  started = false;
  private messageListener: ((event: { data: unknown }) => void) | undefined;
  private closeListener: (() => void) | undefined;

  /** Acknowledge every frame on the next tick, like a healthy renderer. */
  autoAck = false;

  postMessage(message: unknown): void {
    const frame = message as TelemetryFrame;
    this.sent.push(frame);
    if (this.autoAck) queueMicrotask(() => this.ack(frame.seq));
  }
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown {
    if (event === "message") this.messageListener = listener as (e: { data: unknown }) => void;
    else this.closeListener = listener as () => void;
    return this;
  }
  start(): void {
    this.started = true;
  }
  ack(seq: number): void {
    this.messageListener?.({ data: { type: "ack", seq } });
  }
  raw(data: unknown): void {
    this.messageListener?.({ data });
  }
  close(): void {
    this.closeListener?.();
  }
  get seqs(): number[] {
    return this.sent.map((f) => f.seq);
  }
}

/** A round outline for a track key, as if built from one clean lap. */
export function outlineFor(trackKey: string, lengthM = 5200): TrackOutline {
  const points: [number, number][] = [];
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const a = (2 * Math.PI * i) / OUTLINE_POINTS;
    points.push([0.5 + 0.5 * Math.sin(a), 0.5 - 0.5 * Math.cos(a)]);
  }
  return {
    version: 1,
    trackKey,
    points,
    scaleM: lengthM / Math.PI,
    lengthM,
    source: "integrated",
    closureErrorM: 3,
    gapPct: 0.001,
    bridgeM: 5,
    createdAt: "2026-10-30T12:00:00.000Z",
  };
}
