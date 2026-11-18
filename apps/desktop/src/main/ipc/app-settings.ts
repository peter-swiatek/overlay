import { app, ipcMain, type WebContents } from "electron";
import type { AppSettings } from "../../shared/app-settings-types";
import { IPC } from "../../shared/types";
import type { AppSettingsStore } from "../app-settings";
import { HIDDEN_ARG } from "../main-window";
import type { IpcContext } from "./context";

type Senders = Pick<IpcContext, "isSettingsSender" | "isOverlaySender" | "deny">;

/** The pure handlers, keyed by channel; `registerAppSettingsIpc` binds them to Electron. */
export function appSettingsHandlers(
  ctx: Senders,
  store: Pick<AppSettingsStore, "load" | "update">,
): Record<string, (sender: WebContents, ...args: unknown[]) => AppSettings> {
  return {
    [IPC.appSettingsGet]: (sender) => {
      if (!ctx.isSettingsSender(sender) && !ctx.isOverlaySender(sender)) {
        ctx.deny(IPC.appSettingsGet);
      }
      return store.load();
    },
    [IPC.appSettingsUpdate]: (sender, patch) => {
      if (!ctx.isSettingsSender(sender)) ctx.deny(IPC.appSettingsUpdate);
      return store.update(patch);
    },
  };
}

export interface LoginItemDeps {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  setLoginItem(openAtLogin: boolean, args: string[]): void;
  log(message: string): void;
}

/** Applies "Start with Windows" to the OS login item; only for packaged Windows builds. */
export function applyLoginItem(deps: LoginItemDeps, startWithWindows: boolean): boolean {
  if (!deps.isPackaged || deps.platform !== "win32") {
    deps.log("Start with Windows ignored (needs a packaged Windows build)");
    return false;
  }
  // The flag lets the app tell a login start from a start by hand (Windows reports no such thing).
  deps.setLoginItem(startWithWindows, startWithWindows ? [HIDDEN_ARG] : []);
  return true;
}

function electronLoginItem(): LoginItemDeps {
  return {
    isPackaged: app.isPackaged,
    platform: process.platform,
    setLoginItem: (openAtLogin, args) => app.setLoginItemSettings({ openAtLogin, args }),
    log: (message) => console.log(message),
  };
}

export function registerAppSettingsIpc(
  ctx: IpcContext,
  store: AppSettingsStore,
  loginItem: LoginItemDeps = electronLoginItem(),
): void {
  const handlers = appSettingsHandlers(ctx, store);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event.sender, ...args));
  }
  let applied = store.load().general.startWithWindows;
  applyLoginItem(loginItem, applied);
  store.onChange((settings) => {
    ctx.broadcast(IPC.appSettingsChanged, settings);
    if (settings.general.startWithWindows !== applied) {
      applied = settings.general.startWithWindows;
      applyLoginItem(loginItem, applied);
    }
  });
}
