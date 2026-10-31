import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import type { AppSettingsStore } from "../app-settings";
import type { IpcContext } from "./context";

export function registerAppSettingsIpc(ctx: IpcContext, store: AppSettingsStore): void {
  ipcMain.handle(IPC.appSettingsGet, (event) => {
    if (!ctx.isSettingsSender(event.sender) && !ctx.isOverlaySender(event.sender)) {
      ctx.deny(IPC.appSettingsGet);
    }
    return store.load();
  });
  ipcMain.handle(IPC.appSettingsUpdate, (event, patch: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.appSettingsUpdate);
    return store.update(patch);
  });
  store.onChange((settings) => ctx.broadcast(IPC.appSettingsChanged, settings));
}
