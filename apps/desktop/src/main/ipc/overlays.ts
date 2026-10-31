import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import type { OverlaySettingsStore } from "../overlay-settings-store";
import type { IpcContext } from "./context";

export function registerOverlayIpc(ctx: IpcContext, store: OverlaySettingsStore): void {
  const fromSettingsOrOverlay = (sender: Electron.WebContents): boolean =>
    ctx.isSettingsSender(sender) || ctx.isOverlaySender(sender);

  ipcMain.handle(IPC.overlaysGetAll, (event) => {
    if (!fromSettingsOrOverlay(event.sender)) ctx.deny(IPC.overlaysGetAll);
    return store.getAll();
  });
  ipcMain.handle(IPC.overlaysGet, (event, id: unknown) => {
    if (!fromSettingsOrOverlay(event.sender)) ctx.deny(IPC.overlaysGet);
    return typeof id === "string" ? (store.get(id) ?? null) : null;
  });
  ipcMain.handle(IPC.overlaysUpdate, (event, id: unknown, patch: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysUpdate);
    return typeof id === "string" ? (store.update(id, patch) ?? null) : null;
  });
  ipcMain.handle(IPC.overlaysReset, (event, id: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysReset);
    return typeof id === "string" ? (store.reset(id) ?? null) : null;
  });
  store.onChange((id, settings) => ctx.broadcast(IPC.overlaysChanged, id, settings));
}
