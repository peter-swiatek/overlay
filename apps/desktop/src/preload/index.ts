import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OverlayApi } from "../shared/types";

// The sandboxed preload has no DOM typings here; this is the page's own window (isolated world).
const page = globalThis as unknown as {
  postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void;
};

// Hands the telemetry port to the page without exposing ipcRenderer or the port itself.
ipcRenderer.on(IPC.telemetryPort, (event) => {
  page.postMessage({ type: "telemetry-port" }, "*", [...event.ports]);
});

const api: OverlayApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  setDisplaySettings: (patch) => ipcRenderer.invoke(IPC.setDisplaySettings, patch),
  getMetrics: () => ipcRenderer.invoke(IPC.getMetrics),
  getEditMode: () => ipcRenderer.invoke(IPC.getEditMode),
  onEditModeChanged: (callback) => {
    const listener = (_event: unknown, editing: boolean): void => callback(editing);
    ipcRenderer.on(IPC.editModeChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.editModeChanged, listener);
    };
  },
  resizeBy: (dx, dy) => ipcRenderer.send(IPC.resizeBy, dx, dy),
  getCaptureStatus: () => ipcRenderer.invoke(IPC.getCaptureStatus),
  onCaptureStatus: (callback) => {
    const listener = (_event: unknown, status: Parameters<typeof callback>[0]): void =>
      callback(status);
    ipcRenderer.on(IPC.captureStatusChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.captureStatusChanged, listener);
    };
  },
  getCaptureSettings: () => ipcRenderer.invoke(IPC.getCaptureSettings),
  setCaptureSettings: (patch) => ipcRenderer.invoke(IPC.setCaptureSettings, patch),
  subscribeTelemetry: (rateHz) => ipcRenderer.send(IPC.telemetrySubscribe, rateHz),
};

contextBridge.exposeInMainWorld("overlayApi", api);
