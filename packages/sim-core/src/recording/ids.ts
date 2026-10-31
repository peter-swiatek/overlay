/** Fills `bytes` with random values; the default uses the platform CSPRNG. */
export type RandomBytes = (bytes: Uint8Array) => void;

const defaultRandom: RandomBytes = (bytes) => {
  globalThis.crypto.getRandomValues(bytes);
};

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then random bits, so ids sort by creation
 * time and can be generated offline. Release 2 uploads rows under these ids.
 */
export function uuidv7(nowMs: number, random: RandomBytes = defaultRandom): string {
  const bytes = new Uint8Array(16);
  random(bytes);
  writeTimestamp(bytes, nowMs);
  return format(bytes);
}

/**
 * Generator whose ids are strictly increasing even when several are made in one millisecond:
 * the 12 `rand_a` bits count up (the counter method of RFC 9562 section 6.2).
 */
export function createUuidv7Generator(
  random: RandomBytes = defaultRandom,
): (nowMs: number) => string {
  let lastMs = -1;
  let counter = 0;
  return (nowMs) => {
    const bytes = new Uint8Array(16);
    random(bytes);
    let ms = Math.floor(nowMs);
    if (ms <= lastMs) {
      // Same millisecond (or the clock stepped back): keep counting from the previous id.
      ms = lastMs;
      counter++;
      if (counter > 0xfff) {
        ms++;
        counter = 0;
      }
    } else {
      // Start in the lower half so that counting up has room.
      counter = ((bytes[6] ?? 0) & 0x07) << 8;
    }
    lastMs = ms;
    writeTimestamp(bytes, ms);
    bytes[6] = 0x70 | (counter >> 8);
    bytes[7] = counter & 0xff;
    return format(bytes);
  };
}

function writeTimestamp(bytes: Uint8Array, nowMs: number): void {
  let ms = Math.floor(nowMs);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
}

function format(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(value: string): boolean {
  return UUID_V7.test(value);
}

/** The creation time encoded in a UUIDv7, in Unix milliseconds. */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
