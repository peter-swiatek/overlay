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

export interface ConsistentCopy {
  consistent: boolean;
  attempts: number;
}

/**
 * Copies the mapping into `a` and `b` (each sized to the bytes wanted) until both copies match,
 * at most `maxAttempts` times. The writer takes no lock from us, so two equal copies in a row is
 * our evidence that no update tore the frame. Both buffers hold the last attempt afterwards.
 */
export function copyConsistent(
  map: SharedMapping | undefined,
  a: Buffer,
  b: Buffer,
  maxAttempts: number,
): ConsistentCopy {
  let attempts = 0;
  let consistent = false;
  while (map !== undefined && attempts < maxAttempts && !consistent) {
    attempts++;
    map.copy(a, 0, a.length);
    map.copy(b, 0, b.length);
    consistent = a.equals(b);
  }
  return { consistent, attempts };
}
