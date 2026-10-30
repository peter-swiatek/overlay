import type { SharedMapping, SharedMemorySource, SignalEvent } from "./shm";

// Win32 constants.
export const FILE_MAP_READ = 0x4;
export const SYNCHRONIZE = 0x00100000;
export const WAIT_OBJECT_0 = 0;
export const WAIT_TIMEOUT = 0x102;

/** MEMORY_BASIC_INFORMATION on x64 is 48 bytes; RegionSize (SIZE_T) is at offset 24. */
const MBI_BYTES = 48;
const MBI_REGION_SIZE_OFFSET = 24;

type Koffi = typeof import("koffi");

/**
 * Returns a Windows implementation, or undefined on any other platform.
 * koffi is imported here and nowhere else, and only on win32, so Linux typecheck, tests and
 * builds never load a native module.
 *
 * Only read operations are bound: OpenFileMappingW, MapViewOfFile (FILE_MAP_READ), UnmapViewOfFile,
 * CloseHandle, OpenEventW (SYNCHRONIZE), WaitForSingleObject, VirtualQuery and RtlMoveMemory
 * (copy into our own Buffer). Nothing here can write to the game's memory.
 *
 * koffi.view and external ArrayBuffers are not used: Electron's V8 memory cage rejects them.
 */
export async function createWindowsSharedMemorySource(): Promise<SharedMemorySource | undefined> {
  if (process.platform !== "win32") return undefined;

  const imported = (await import("koffi")) as unknown as Koffi & { default?: Koffi };
  const koffi: Koffi = imported.default ?? imported;
  const kernel32 = koffi.load("kernel32.dll");

  // HANDLE and pointers are bound as uintptr_t so they are plain integers we can add offsets to.
  const OpenFileMappingW = kernel32.func(
    "uintptr_t __stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)",
  );
  const MapViewOfFile = kernel32.func(
    "uintptr_t __stdcall MapViewOfFile(uintptr_t handle, uint32_t access, uint32_t offsetHigh, uint32_t offsetLow, size_t bytes)",
  );
  const UnmapViewOfFile = kernel32.func("int __stdcall UnmapViewOfFile(uintptr_t base)");
  const CloseHandle = kernel32.func("int __stdcall CloseHandle(uintptr_t handle)");
  const OpenEventW = kernel32.func(
    "uintptr_t __stdcall OpenEventW(uint32_t access, int inherit, str16 name)",
  );
  const WaitForSingleObject = kernel32.func(
    "uint32_t __stdcall WaitForSingleObject(uintptr_t handle, uint32_t ms)",
  );
  const VirtualQuery = kernel32.func(
    "size_t __stdcall VirtualQuery(uintptr_t address, void *info, size_t length)",
  );
  const RtlMoveMemory = kernel32.func(
    "void __stdcall RtlMoveMemory(void *dst, uintptr_t src, size_t length)",
  );

  const num = (value: unknown): number => Number(value);

  return {
    openMapping(name: string): SharedMapping | undefined {
      const handle = num(OpenFileMappingW(FILE_MAP_READ, 0, name));
      if (handle === 0) return undefined;
      const base = num(MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0));
      if (base === 0) {
        CloseHandle(handle);
        return undefined;
      }
      const info = Buffer.alloc(MBI_BYTES);
      const queried = num(VirtualQuery(base, info, MBI_BYTES));
      const size = queried === 0 ? 0 : num(info.readBigUInt64LE(MBI_REGION_SIZE_OFFSET));
      if (size === 0) {
        UnmapViewOfFile(base);
        CloseHandle(handle);
        return undefined;
      }
      let closed = false;
      return {
        size,
        copy(dst, srcOffset, length, dstOffset = 0) {
          if (closed) throw new Error("Mapping is closed");
          if (srcOffset < 0 || length < 0 || srcOffset + length > size) {
            throw new RangeError(`Copy ${srcOffset}+${length} outside mapping of ${size} bytes`);
          }
          if (dstOffset + length > dst.length) throw new RangeError("Destination too small");
          RtlMoveMemory(dst.subarray(dstOffset, dstOffset + length), base + srcOffset, length);
        },
        close() {
          if (closed) return;
          closed = true;
          UnmapViewOfFile(base);
          CloseHandle(handle);
        },
      };
    },

    openEvent(name: string): SignalEvent | undefined {
      const handle = num(OpenEventW(SYNCHRONIZE, 0, name));
      if (handle === 0) return undefined;
      let closed = false;
      return {
        wait(timeoutMs) {
          if (closed) return false;
          return num(WaitForSingleObject(handle, timeoutMs)) === WAIT_OBJECT_0;
        },
        close() {
          if (closed) return;
          closed = true;
          CloseHandle(handle);
        },
      };
    },
  };
}
