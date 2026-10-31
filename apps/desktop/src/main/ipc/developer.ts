import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import type { CaptureManager } from "../capture-manager";
import { summarizeMetrics } from "../metrics";
import type { IpcContext } from "./context";

export interface DeveloperIpcDeps {
  /** Lazy: the capture manager is created after IPC registration. */
  getCapture(): CaptureManager | undefined;
  getAppMetrics(): Electron.ProcessMetric[];
}

export function registerDeveloperIpc(ctx: IpcContext, deps: DeveloperIpcDeps): void {
  ipcMain.handle(IPC.getMetrics, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getMetrics);
    return summarizeMetrics(deps.getAppMetrics());
  });
  ipcMain.handle(IPC.getCaptureStatus, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getCaptureStatus);
    return deps.getCapture()?.getStatus();
  });
  ipcMain.handle(IPC.getCaptureSettings, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getCaptureSettings);
    return deps.getCapture()?.getSettings();
  });
  ipcMain.handle(IPC.setCaptureSettings, (event, patch: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.setCaptureSettings);
    return deps.getCapture()?.setSettings(patch);
  });
}
