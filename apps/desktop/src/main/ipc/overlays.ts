import { ipcMain } from "electron";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import { IPC, type OverlaySize } from "../../shared/types";
import type { Layout } from "../layout";
import type { OverlaySettingsStore } from "../overlay-settings-store";
import type { IpcContext } from "./context";

type Sender = Electron.WebContents;
type Handler = (event: { sender: Sender }, ...args: unknown[]) => unknown;

/** Pure: each placed overlay's on-screen size (the window's DIP size, already scaled) and scale. */
export function overlaySizes(layout: Layout): Record<string, OverlaySize> {
  return Object.fromEntries(
    Object.entries(layout).map(([id, b]) => [
      id,
      { width: b.width, height: b.height, scalePct: b.scalePct },
    ]),
  );
}

/** The `overlays:*` handlers as plain functions, so tests need no Electron. */
export function createOverlayIpcHandlers(
  ctx: IpcContext,
  store: OverlaySettingsStore,
  getLayout: () => Layout = () => ({}),
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
    [IPC.overlaysGetSizes]: (event) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysGetSizes);
      return overlaySizes(getLayout());
    },
    [IPC.overlaysReset]: (event, id) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysReset);
      return typeof id === "string" ? orNull(store.reset(id)) : null;
    },
    [IPC.overlaysAddInstance]: (event, sourceId) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysAddInstance);
      return typeof sourceId === "string" ? (store.addInstance(sourceId) ?? null) : null;
    },
    [IPC.overlaysRemoveInstance]: (event, id) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.overlaysRemoveInstance);
      return typeof id === "string" ? store.removeInstance(id) : false;
    },
  };
}

export function registerOverlayIpc(
  ctx: IpcContext,
  store: OverlaySettingsStore,
  getLayout: () => Layout,
): void {
  const handlers = createOverlayIpcHandlers(ctx, store, getLayout);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...args));
  }
  broadcastOverlayChanges(ctx, store);
}

/** Tells every window when an instance's settings really changed or an instance was removed. */
export function broadcastOverlayChanges(ctx: IpcContext, store: OverlaySettingsStore): () => void {
  const offChange = store.onChange((id, settings) =>
    ctx.broadcast(IPC.overlaysChanged, id, settings),
  );
  const offRemove = store.onRemove((id) => ctx.broadcast(IPC.overlaysRemoved, id));
  return () => {
    offChange();
    offRemove();
  };
}
