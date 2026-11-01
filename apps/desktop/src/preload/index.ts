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

/** Subscribes to a main-to-renderer channel; returns the unsubscribe function. */
function subscribe<A extends unknown[]>(
  channel: string,
  callback: (...args: A) => void,
): () => void {
  const listener = (_event: unknown, ...args: unknown[]): void => callback(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: OverlayApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  setDisplaySettings: (patch) => ipcRenderer.invoke(IPC.setDisplaySettings, patch),
  getMetrics: () => ipcRenderer.invoke(IPC.getMetrics),
  startPerfCheck: () => ipcRenderer.invoke(IPC.perfStart),
  cancelPerfCheck: () => ipcRenderer.invoke(IPC.perfCancel),
  onPerfProgress: (callback) => subscribe(IPC.perfProgress, callback),
  getEditMode: () => ipcRenderer.invoke(IPC.getEditMode),
  onEditModeChanged: (callback) => {
    const listener = (_event: unknown, editing: boolean): void => callback(editing);
    ipcRenderer.on(IPC.editModeChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.editModeChanged, listener);
    };
  },
  resizeBy: (dx, dy) => ipcRenderer.send(IPC.resizeBy, dx, dy),
  reportContentMinSize: (size) => ipcRenderer.send(IPC.contentMinSize, size),
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
  overlays: {
    getAll: () => ipcRenderer.invoke(IPC.overlaysGetAll),
    get: (id) => ipcRenderer.invoke(IPC.overlaysGet, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.overlaysUpdate, id, patch),
    reset: (id) => ipcRenderer.invoke(IPC.overlaysReset, id),
    onChanged: (callback) => subscribe(IPC.overlaysChanged, callback),
  },
  theme: {
    getState: () => ipcRenderer.invoke(IPC.themeGetState),
    getActive: () => ipcRenderer.invoke(IPC.themeGetActive),
    setActive: (id) => ipcRenderer.invoke(IPC.themeSetActive, id),
    save: (theme) => ipcRenderer.invoke(IPC.themeSave, theme),
    remove: (id) => ipcRenderer.invoke(IPC.themeRemove, id),
    importCode: (code) => ipcRenderer.invoke(IPC.themeImportCode, code),
    exportCode: (id) => ipcRenderer.invoke(IPC.themeExportCode, id),
    importFile: () => ipcRenderer.invoke(IPC.themeImportFile),
    exportFile: (id) => ipcRenderer.invoke(IPC.themeExportFile, id),
    onChanged: (callback) => subscribe(IPC.themeChanged, callback),
  },
  appSettings: {
    get: () => ipcRenderer.invoke(IPC.appSettingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.appSettingsUpdate, patch),
    onChanged: (callback) => subscribe(IPC.appSettingsChanged, callback),
  },
  telemetry: {
    getSource: () => ipcRenderer.invoke(IPC.telemetryGetSource),
    setSource: (source) => ipcRenderer.invoke(IPC.telemetrySetSource, source),
    pickReplayFile: () => ipcRenderer.invoke(IPC.telemetryPickReplay),
    getStatus: () => ipcRenderer.invoke(IPC.telemetryGetStatus),
    onStatus: (callback) => subscribe(IPC.telemetryStatusChanged, callback),
    onSourceChanged: (callback) => subscribe(IPC.telemetrySourceChanged, callback),
  },
  restartApp: () => ipcRenderer.invoke(IPC.appRestart),
};

contextBridge.exposeInMainWorld("overlayApi", api);
