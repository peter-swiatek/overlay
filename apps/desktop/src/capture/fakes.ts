import type { Clock, SharedMapping, SharedMemorySource, SignalEvent } from "./shm";

/** Test doubles: a controllable clock and an in-memory SharedMemorySource. */
export class FakeClock implements Clock {
  constructor(
    private mono = 1000,
    private wall = Date.UTC(2026, 9, 30, 10, 0, 0),
  ) {}
  monoMs(): number {
    return this.mono;
  }
  wallMs(): number {
    return this.wall;
  }
  advance(ms: number): void {
    this.mono += ms;
    this.wall += ms;
  }
}

export class FakeMapping implements SharedMapping {
  copies = 0;
  /** Called after every copy with the copied range; tests use it to simulate a concurrent writer. */
  onCopy: ((srcOffset: number, length: number) => void) | undefined;
  opens = 0;
  closes = 0;

  constructor(public data: Buffer) {}

  get size(): number {
    return this.data.length;
  }

  get isOpen(): boolean {
    return this.opens > this.closes;
  }

  copy(dst: Buffer, srcOffset: number, length: number, dstOffset = 0): void {
    if (srcOffset + length > this.data.length) throw new RangeError("outside mapping");
    this.data.copy(dst, dstOffset, srcOffset, srcOffset + length);
    this.copies++;
    this.onCopy?.(srcOffset, length);
  }

  close(): void {
    this.closes++;
  }
}

export class FakeEvent implements SignalEvent {
  waits: number[] = [];
  onWait: (() => void) | undefined;
  signalled = true;
  opens = 0;
  closes = 0;
  wait(timeoutMs: number): boolean {
    this.waits.push(timeoutMs);
    this.onWait?.();
    return this.signalled;
  }
  close(): void {
    this.closes++;
  }
}

export class FakeSharedMemory implements SharedMemorySource {
  readonly mappings = new Map<string, FakeMapping>();
  readonly events = new Map<string, FakeEvent>();

  openMapping(name: string): SharedMapping | undefined {
    const mapping = this.mappings.get(name);
    if (!mapping) return undefined;
    mapping.opens++;
    return mapping;
  }

  openEvent(name: string): SignalEvent | undefined {
    const event = this.events.get(name);
    if (!event) return undefined;
    event.opens++;
    return event;
  }
}
