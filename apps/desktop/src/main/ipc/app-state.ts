import { ipcMain } from "electron";
import { IPC, type AppState, type OverlaySize } from "../../shared/types";
import type { IpcContext } from "./context";

type Sender = Electron.WebContents;
type Handler = (event: { sender: Sender }, ...args: unknown[]) => unknown;

/**
 * Stub handlers for `app-state:*`, `overlays:get-sizes` and `app:quit` so the API resolves with
 * defaults. Owned by MW-1, which replaces these with real ones backed by OverlayManager (and moves
 * `get-sizes` into ipc/overlays.ts). Main-window-only: other senders are denied.
 */
export function createAppStateIpcHandlers(ctx: IpcContext): Record<string, Handler> {
  const state: AppState = { overlaysVisible: true, overlaysLocked: true };
  const sizes: Record<string, OverlaySize> = {};
  const guard = (channel: string, sender: Sender): void => {
    if (!ctx.isSettingsSender(sender)) ctx.deny(channel);
  };
  return {
    [IPC.appStateGet]: (event) => {
      guard(IPC.appStateGet, event.sender);
      return { ...state };
    },
    [IPC.appStateSet]: (event) => {
      guard(IPC.appStateSet, event.sender);
      return { ...state };
    },
    [IPC.overlaysGetSizes]: (event) => {
      guard(IPC.overlaysGetSizes, event.sender);
      return { ...sizes };
    },
    [IPC.appQuit]: (event) => {
      guard(IPC.appQuit, event.sender);
    },
  };
}

export function registerAppStateIpc(ctx: IpcContext): void {
  for (const [channel, handler] of Object.entries(createAppStateIpcHandlers(ctx))) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...args));
  }
}
