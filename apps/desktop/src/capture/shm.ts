/**
 * Read-only access to named Windows shared memory and events.
 * The capture code only ever sees these interfaces, so it can be tested with a fake.
 */
export interface SharedMapping {
  /** Real mapped size in bytes (page-rounded, from VirtualQuery). */
  readonly size: number;
  /** Copies `length` bytes starting at `srcOffset` into `dst` at `dstOffset`. Never writes to the mapping. */
  copy(dst: Buffer, srcOffset: number, length: number, dstOffset?: number): void;
  close(): void;
}

export interface SignalEvent {
  /** Blocks up to `timeoutMs`. True when the event was signalled, false on timeout. */
  wait(timeoutMs: number): boolean;
  close(): void;
}

export interface SharedMemorySource {
  /** Opens an existing mapping read-only; undefined when it does not exist. */
  openMapping(name: string): SharedMapping | undefined;
  /** Opens an existing event with SYNCHRONIZE access only; undefined when it does not exist. */
  openEvent(name: string): SignalEvent | undefined;
}

export interface Clock {
  monoMs(): number;
  wallMs(): number;
}

export const systemClock: Clock = {
  monoMs: () => performance.now(),
  wallMs: () => Date.now(),
};
