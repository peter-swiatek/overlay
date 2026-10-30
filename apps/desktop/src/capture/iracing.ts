import type { SimId } from "@overlay/sim-core";
import { RecordKind } from "@overlay/sim-core";
import type { RecordSink, SimCapture } from "./sim-capture";
import { STALE_CLOSE_MS } from "./sim-capture";
import type { Clock, SharedMapping, SharedMemorySource, SignalEvent } from "./shm";

/*
 * Layout constants come from iRacing's freely distributed SDK header `irsdk_defines.h`
 * (struct irsdk_header, struct irsdk_varBuf, struct irsdk_varHeader). Only the public fields
 * needed to copy the data are read; the payloads themselves are stored raw.
 */
export const IRSDK_MAP_NAME = "Local\\IRSDKMemMapFileName";
export const IRSDK_EVENT_NAME = "Local\\IRSDKDataValidEvent";
export const IRSDK_HEADER_BYTES = 112;
export const IRSDK_VAR_HEADER_BYTES = 144;
export const IRSDK_MAX_BUFS = 4;
/** irsdk_StatusField::irsdk_stConnected */
export const IRSDK_ST_CONNECTED = 1;
export const IRSDK_EVENT_TIMEOUT_MS = 200;

const OFF = {
  ver: 0,
  status: 4,
  tickRate: 8,
  sessionInfoUpdate: 12,
  sessionInfoLen: 16,
  sessionInfoOffset: 20,
  numVars: 24,
  varHeaderOffset: 28,
  numBuf: 32,
  bufLen: 36,
  varBuf: 48,
} as const;
const VAR_BUF_ENTRY_BYTES = 16;

export interface IrsdkVarBuf {
  tickCount: number;
  bufOffset: number;
}

export interface IrsdkHeader {
  ver: number;
  status: number;
  tickRate: number;
  sessionInfoUpdate: number;
  sessionInfoLen: number;
  sessionInfoOffset: number;
  numVars: number;
  varHeaderOffset: number;
  numBuf: number;
  bufLen: number;
  varBuf: IrsdkVarBuf[];
}

export function parseIrsdkHeader(buf: Buffer): IrsdkHeader {
  const varBuf: IrsdkVarBuf[] = [];
  for (let i = 0; i < IRSDK_MAX_BUFS; i++) {
    const at = OFF.varBuf + i * VAR_BUF_ENTRY_BYTES;
    varBuf.push({ tickCount: buf.readInt32LE(at), bufOffset: buf.readInt32LE(at + 4) });
  }
  return {
    ver: buf.readInt32LE(OFF.ver),
    status: buf.readInt32LE(OFF.status),
    tickRate: buf.readInt32LE(OFF.tickRate),
    sessionInfoUpdate: buf.readInt32LE(OFF.sessionInfoUpdate),
    sessionInfoLen: buf.readInt32LE(OFF.sessionInfoLen),
    sessionInfoOffset: buf.readInt32LE(OFF.sessionInfoOffset),
    numVars: buf.readInt32LE(OFF.numVars),
    varHeaderOffset: buf.readInt32LE(OFF.varHeaderOffset),
    numBuf: buf.readInt32LE(OFF.numBuf),
    bufLen: buf.readInt32LE(OFF.bufLen),
    varBuf,
  };
}

/** Index of the var buffer with the highest tickCount, or -1 when there is none. */
export function newestVarBuf(header: IrsdkHeader): number {
  const count = Math.min(Math.max(header.numBuf, 0), IRSDK_MAX_BUFS);
  let best = -1;
  for (let i = 0; i < count; i++) {
    const entry = header.varBuf[i];
    if (entry && (best < 0 || entry.tickCount > (header.varBuf[best]?.tickCount ?? -1))) best = i;
  }
  return best;
}

export class IracingCapture implements SimCapture {
  readonly sim: SimId = "iracing";
  live = false;
  frames = 0;
  tornDiscarded = 0;

  private map: SharedMapping | undefined;
  private event: SignalEvent | undefined;
  private sink: RecordSink | undefined;
  private readonly head = Buffer.alloc(IRSDK_HEADER_BYTES);
  private varBuffer = Buffer.alloc(4);
  private lastTick = -1;
  private lastNumVars = -1;
  private lastSessionUpdate = -1;
  private observedTick = -1;
  private lastTickChangeMono = 0;
  private lastLiveMono = 0;

  constructor(
    private readonly source: SharedMemorySource,
    private readonly clock: Clock,
  ) {}

  get isOpen(): boolean {
    return this.map !== undefined;
  }

  headerExtras(): Record<string, unknown> {
    return { iracingMappedSize: this.map?.size ?? 0 };
  }

  async probe(): Promise<void> {
    const now = this.clock.monoMs();
    if (!this.map) {
      this.map = this.source.openMapping(IRSDK_MAP_NAME);
      this.event = this.map ? this.source.openEvent(IRSDK_EVENT_NAME) : undefined;
      this.observedTick = -1;
      this.lastTickChangeMono = now;
      this.lastLiveMono = now;
    }
    if (!this.map) {
      this.live = false;
      return;
    }
    const header = this.readHeader();
    this.updateLiveness(header, now);
    if (!this.live && now - this.lastLiveMono > STALE_CLOSE_MS) this.close();
  }

  async beginFile(sink: RecordSink): Promise<void> {
    this.sink = sink;
    this.lastTick = -1;
    this.lastNumVars = -1;
    this.lastSessionUpdate = -1;
    this.frames = 0;
    this.tornDiscarded = 0;
  }

  onMarker(): void {}

  async step(): Promise<void> {
    const sink = this.sink;
    const map = this.map;
    if (!sink || !map || !this.live) return;
    this.event?.wait(IRSDK_EVENT_TIMEOUT_MS);

    const header = this.readHeader();
    this.updateLiveness(header, this.clock.monoMs());
    if (!this.live) return;
    if (!this.sane(header, map)) return;

    if (header.numVars !== this.lastNumVars) {
      const length = header.varHeaderOffset + header.numVars * IRSDK_VAR_HEADER_BYTES;
      const blob = Buffer.alloc(length);
      map.copy(blob, 0, length);
      await sink.write(RecordKind.IracingHeader, blob);
      this.lastNumVars = header.numVars;
    }

    if (header.sessionInfoUpdate !== this.lastSessionUpdate && header.sessionInfoLen > 0) {
      const yaml = Buffer.alloc(header.sessionInfoLen);
      map.copy(yaml, header.sessionInfoOffset, header.sessionInfoLen);
      const after = this.readHeader();
      if (after.sessionInfoUpdate === header.sessionInfoUpdate) {
        const end = yaml.indexOf(0);
        await sink.write(RecordKind.IracingSessionYaml, end < 0 ? yaml : yaml.subarray(0, end));
        this.lastSessionUpdate = header.sessionInfoUpdate;
      }
      // Otherwise the YAML changed while we copied it; the next step copies it again.
    }

    const index = newestVarBuf(header);
    const entry = header.varBuf[index];
    if (!entry || entry.tickCount === this.lastTick) return;
    if (this.varBuffer.length !== 4 + header.bufLen)
      this.varBuffer = Buffer.alloc(4 + header.bufLen);
    map.copy(this.varBuffer, entry.bufOffset, header.bufLen, 4);
    // The sim rewrites the oldest buffer in place; if its tickCount moved, our copy is torn.
    const recheck = this.readHeader();
    if (recheck.varBuf[index]?.tickCount !== entry.tickCount) {
      this.tornDiscarded++;
      return;
    }
    this.varBuffer.writeInt32LE(entry.tickCount, 0);
    await sink.write(RecordKind.IracingVarBuffer, this.varBuffer);
    this.lastTick = entry.tickCount;
    this.frames++;
  }

  async endFile(): Promise<Record<string, unknown>> {
    this.sink = undefined;
    return { frames: this.frames, tornDiscarded: this.tornDiscarded };
  }

  close(): void {
    this.map?.close();
    this.event?.close();
    this.map = undefined;
    this.event = undefined;
    this.live = false;
  }

  private readHeader(): IrsdkHeader {
    this.map?.copy(this.head, 0, IRSDK_HEADER_BYTES);
    return parseIrsdkHeader(this.head);
  }

  private updateLiveness(header: IrsdkHeader, now: number): void {
    const index = newestVarBuf(header);
    const tick = header.varBuf[index]?.tickCount ?? -1;
    if (tick !== this.observedTick) {
      this.observedTick = tick;
      this.lastTickChangeMono = now;
    }
    // Our own handle keeps the mapping alive after the sim exits, so an open mapping proves nothing:
    // require the connected bit, and ticks that still advance.
    this.live =
      (header.status & IRSDK_ST_CONNECTED) !== 0 && now - this.lastTickChangeMono <= STALE_CLOSE_MS;
    if (this.live) this.lastLiveMono = now;
  }

  private sane(header: IrsdkHeader, map: SharedMapping): boolean {
    const index = newestVarBuf(header);
    const entry = header.varBuf[index];
    return (
      !!entry &&
      header.numVars > 0 &&
      header.bufLen > 0 &&
      header.varHeaderOffset >= IRSDK_HEADER_BYTES &&
      header.varHeaderOffset + header.numVars * IRSDK_VAR_HEADER_BYTES <= map.size &&
      entry.bufOffset >= 0 &&
      entry.bufOffset + header.bufLen <= map.size &&
      header.sessionInfoOffset >= 0 &&
      header.sessionInfoOffset + Math.max(header.sessionInfoLen, 0) <= map.size
    );
  }
}
