import type { NativeLoader, NativeZOrder } from "./zorder";

type Koffi = typeof import("koffi");

const EVENT_SYSTEM_FOREGROUND = 0x0003;
const WINEVENT_OUTOFCONTEXT = 0x0000;
const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const SWP_NOOWNERZORDER = 0x200;

/**
 * Loads koffi and hooks foreground-window changes. koffi is imported here and nowhere else, and
 * only on win32, so Linux typecheck, tests and builds never load it. Must run on the main thread:
 * out-of-context hooks are delivered through its message loop.
 */
export const loadWin32ZOrder: NativeLoader = async (onForeground) => {
  if (process.platform !== "win32") return undefined;
  const imported = (await import("koffi")) as unknown as Koffi & { default?: Koffi };
  const koffi: Koffi = imported.default ?? imported;
  const user32 = koffi.load("user32.dll");

  const Proc = koffi.proto(
    "void __stdcall WinEventProc(uintptr_t hook, uint32_t event, uintptr_t hwnd, int32_t idObject, int32_t idChild, uint32_t thread, uint32_t time)",
  );
  const setWinEventHook = user32.func(
    "uintptr_t __stdcall SetWinEventHook(uint32_t eventMin, uint32_t eventMax, uintptr_t hmod, Proc *fn, uint32_t pid, uint32_t tid, uint32_t flags)",
  );
  const unhookWinEvent = user32.func("int __stdcall UnhookWinEvent(uintptr_t hook)");
  const setWindowPos = user32.func(
    "int __stdcall SetWindowPos(uintptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)",
  );

  // Registered callback; it stays valid until unregistered.
  const callback = koffi.register((_hook: number, _event: number, hwnd: number) => {
    try {
      onForeground(Number(hwnd));
    } catch (error) {
      console.warn("Foreground hook callback failed", error);
    }
  }, koffi.pointer(Proc));

  const hook = Number(
    setWinEventHook(
      EVENT_SYSTEM_FOREGROUND,
      EVENT_SYSTEM_FOREGROUND,
      0,
      callback,
      0,
      0,
      WINEVENT_OUTOFCONTEXT,
    ),
  );
  if (hook === 0) console.warn("SetWinEventHook failed; relying on the fallback timer");

  const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;
  const native: NativeZOrder = {
    setTopmost: (hwnd) => {
      setWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
    },
    dispose: () => {
      if (hook !== 0) unhookWinEvent(hook);
      // An already-queued foreground event may still arrive after unhooking, so free the
      // callback slot on a later turn rather than immediately.
      setImmediate(() => koffi.unregister(callback));
    },
  };
  return native;
};
