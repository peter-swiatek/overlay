import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC, type OverlayApi } from "../shared/types";

const exposed = vi.hoisted(() => ({ api: undefined as unknown }));
const ipc = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      exposed.api = api;
    },
  },
  ipcRenderer: ipc,
}));

async function loadApi(): Promise<OverlayApi> {
  vi.resetModules();
  await import("./index");
  return exposed.api as OverlayApi;
}

describe("preload API", () => {
  beforeEach(() => {
    ipc.invoke.mockClear();
    ipc.on.mockClear();
  });

  it("exposes the main-window additions", async () => {
    const api = await loadApi();
    expect(typeof api.quit).toBe("function");
    for (const name of ["get", "set", "onChanged"] as const) {
      expect(typeof api.appState[name]).toBe("function");
    }
    expect(typeof api.overlays.getSizes).toBe("function");
    expect(typeof api.overlays.onSizesChanged).toBe("function");
  });

  it("wires each call to its channel", async () => {
    const api = await loadApi();
    await api.appState.get();
    await api.appState.set({ overlaysLocked: false });
    await api.overlays.getSizes();
    await api.quit();
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.appStateGet);
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.appStateSet, { overlaysLocked: false });
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.overlaysGetSizes);
    expect(ipc.invoke).toHaveBeenCalledWith(IPC.appQuit);
    api.appState.onChanged(() => undefined);
    api.overlays.onSizesChanged(() => undefined);
    const channels = ipc.on.mock.calls.map((call) => (call as unknown[])[0]);
    expect(channels).toContain(IPC.appStateChanged);
    expect(channels).toContain(IPC.overlaysSizesChanged);
  });

  it("sends the table font report on its channel", async () => {
    const api = await loadApi();
    api.reportTableMetrics({ chPx: 8.6, cellPadPx: 7 });
    expect(ipc.send).toHaveBeenCalledWith(IPC.tableMetrics, { chPx: 8.6, cellPadPx: 7 });
    expect(IPC.tableMetrics).toBe("overlays:table-metrics");
    api.reportWebPageRect({ x: 0, y: 20, width: 400, height: 240 });
    expect(ipc.send).toHaveBeenCalledWith(IPC.webPageRect, {
      x: 0,
      y: 20,
      width: 400,
      height: 240,
    });
    api.reportWebPageRect(null);
    expect(ipc.send).toHaveBeenCalledWith(IPC.webPageRect, null);
  });

  it("uses the agreed channel names", () => {
    expect(IPC.appStateGet).toBe("app-state:get");
    expect(IPC.appStateSet).toBe("app-state:set");
    expect(IPC.appStateChanged).toBe("app-state:changed");
    expect(IPC.overlaysGetSizes).toBe("overlays:get-sizes");
    expect(IPC.overlaysSizesChanged).toBe("overlays:sizes-changed");
    expect(IPC.appQuit).toBe("app:quit");
  });
});
