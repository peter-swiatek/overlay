import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OverlayApi } from "../shared/types";

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
};

contextBridge.exposeInMainWorld("overlayApi", api);
