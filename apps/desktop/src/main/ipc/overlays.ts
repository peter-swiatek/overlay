import { ipcMain } from "electron";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import { IPC } from "../../shared/types";
import type { OverlaySettingsStore } from "../overlay-settings-store";
import type { IpcContext } from "./context";

type Sender = Electron.WebContents;
type Handler = (event: { sender: Sender }, ...args: unknown[]) => unknown;

/** The `overlays:*` handlers as plain functions, so tests need no Electron. */
export function createOverlayIpcHandlers(
  ctx: IpcContext,
  store: OverlaySettingsStore,
): Record<string, Handler> {
  const fromSettingsOrOverlay = (sender: Sender): boolean =>
    ctx.isSettingsSender(sender) || ctx.isOverlaySender(sender);
  const orNull = (settings: OverlayInstanceSettings | undefined): OverlayInstanceSettings | null =>
    settings ?? null;

  return {
    [IPC.overlaysGetAll]: (event) => {
      if (!fromSettingsOrOverlay(event.sender)) ctx.deny(IPC.overlaysGetAll);
      return store.getAll();
    },
    [IPC.overlaysGet]: (event, id) => {
      if (!fromSettingsOrOverlay(event.sender)) ctx.deny(IPC.overlaysGet);
      return typeof id === "string" ? orNull(store.get(id)) : null;
    },
    [IPC.overlaysUpdate]: (event, id, patch) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysUpdate);
      return typeof id === "string" ? orNull(store.update(id, patch)) : null;
    },
    [IPC.overlaysReset]: (event, id) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysReset);
      return typeof id === "string" ? orNull(store.reset(id)) : null;
    },
  };
}

export function registerOverlayIpc(ctx: IpcContext, store: OverlaySettingsStore): void {
  const handlers = createOverlayIpcHandlers(ctx, store);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...args));
  }
  broadcastOverlayChanges(ctx, store);
}

/** Tells every window when an overlay's settings really changed. */
export function broadcastOverlayChanges(ctx: IpcContext, store: OverlaySettingsStore): () => void {
  return store.onChange((id, settings) => ctx.broadcast(IPC.overlaysChanged, id, settings));
}
