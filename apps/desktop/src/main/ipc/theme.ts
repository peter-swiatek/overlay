import { ipcMain } from "electron";
import type { ThemeImportResult } from "@overlay/theme/types";
import { IPC } from "../../shared/types";
import type { ThemeStore } from "../theme-store";
import type { IpcContext } from "./context";

export function registerThemeIpc(ctx: IpcContext, store: ThemeStore): void {
  const settingsOnly = (sender: Electron.WebContents, channel: string): void => {
    if (!ctx.isSettingsSender(sender)) ctx.deny(channel);
  };

  ipcMain.handle(IPC.themeGetState, (event) => {
    settingsOnly(event.sender, IPC.themeGetState);
    return store.getState();
  });
  ipcMain.handle(IPC.themeGetActive, (event) => {
    if (!ctx.isSettingsSender(event.sender) && !ctx.isOverlaySender(event.sender)) {
      ctx.deny(IPC.themeGetActive);
    }
    return store.getActive();
  });
  ipcMain.handle(IPC.themeSetActive, (event, id: unknown) => {
    settingsOnly(event.sender, IPC.themeSetActive);
    return typeof id === "string" ? store.setActive(id) : store.getState();
  });
  ipcMain.handle(IPC.themeSave, (event, theme: unknown) => {
    settingsOnly(event.sender, IPC.themeSave);
    return store.save(theme);
  });
  ipcMain.handle(IPC.themeRemove, (event, id: unknown) => {
    settingsOnly(event.sender, IPC.themeRemove);
    return typeof id === "string" ? store.remove(id) : store.getState();
  });
  // Stubs until the theme ticket adds the codec and file dialogs.
  ipcMain.handle(IPC.themeImportCode, (event): ThemeImportResult => {
    settingsOnly(event.sender, IPC.themeImportCode);
    return { ok: false, error: "Not implemented yet" };
  });
  ipcMain.handle(IPC.themeExportCode, (event): string | null => {
    settingsOnly(event.sender, IPC.themeExportCode);
    return null;
  });
  ipcMain.handle(IPC.themeImportFile, (event): ThemeImportResult | null => {
    settingsOnly(event.sender, IPC.themeImportFile);
    return null;
  });
  ipcMain.handle(IPC.themeExportFile, (event): boolean => {
    settingsOnly(event.sender, IPC.themeExportFile);
    return false;
  });
  store.onChange((active) => ctx.broadcast(IPC.themeChanged, active));
}
