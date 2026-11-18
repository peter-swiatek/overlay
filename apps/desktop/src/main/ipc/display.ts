import { ipcMain } from "electron";
import { BUILD_INFO } from "../../shared/build-info";
import { IPC, type AppInfo, type DisplaySettings } from "../../shared/types";
import { HIDDEN_ARG } from "../main-window";
import { SAFE_MODE_FLAG, type SettingsStore } from "../settings";
import type { IpcContext } from "./context";

export interface DisplayIpcDeps {
  settingsStore: SettingsStore;
  /** Display settings in effect for this run (stored settings plus --safe-mode). */
  effective: DisplaySettings;
  safeMode: boolean;
  isPackaged: boolean;
  relaunch(args: string[]): void;
  quit(): void;
}

/**
 * Arguments for the relaunched process: ours minus --safe-mode, which is a one-run choice, and
 * --hidden, which marks a login start. A relaunch is always the user's own action, so the window
 * must open.
 */
export function relaunchArgs(argv: readonly string[]): string[] {
  return argv.slice(1).filter((arg) => arg !== SAFE_MODE_FLAG && arg !== HIDDEN_ARG);
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
      isPackaged: deps.isPackaged,
    };
  });
  ipcMain.handle(IPC.setDisplaySettings, (event, patch: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.setDisplaySettings);
    return deps.settingsStore.update(patch);
  });
  ipcMain.handle(IPC.appRestart, (event): void => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.appRestart);
    deps.relaunch(relaunchArgs(process.argv));
    deps.quit();
  });
}
