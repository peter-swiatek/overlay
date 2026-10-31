import { ipcMain } from "electron";
import { BUILD_INFO } from "../../shared/build-info";
import { IPC, type AppInfo, type DisplaySettings } from "../../shared/types";
import type { SettingsStore } from "../settings";
import type { IpcContext } from "./context";

export interface DisplayIpcDeps {
  settingsStore: SettingsStore;
  /** Display settings in effect for this run (stored settings plus --safe-mode). */
  effective: DisplaySettings;
  safeMode: boolean;
  relaunch(args: string[]): void;
  quit(): void;
}

export function registerDisplayIpc(ctx: IpcContext, deps: DisplayIpcDeps): void {
  ipcMain.handle(IPC.getAppInfo, (event): AppInfo => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getAppInfo);
    return {
      version: BUILD_INFO.version,
      build: BUILD_INFO,
      display: deps.settingsStore.load(),
      effective: deps.effective,
      safeMode: deps.safeMode,
    };
  });
  ipcMain.handle(IPC.setDisplaySettings, (event, patch: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.setDisplaySettings);
    return deps.settingsStore.update(patch);
  });
  ipcMain.handle(IPC.appRestart, (event): void => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.appRestart);
    deps.relaunch([]);
    deps.quit();
  });
}
