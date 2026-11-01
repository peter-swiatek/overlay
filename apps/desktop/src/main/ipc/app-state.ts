import { ipcMain } from "electron";
import { IPC, type AppState } from "../../shared/types";
import type { IpcContext } from "./context";

type Sender = Electron.WebContents;
type Handler = (event: { sender: Sender }, ...args: unknown[]) => unknown;

/** The part of OverlayManager the app state maps onto. `locked` is the inverse of edit mode. */
export interface AppStateSource {
  readonly isVisible: boolean;
  readonly isEditMode: boolean;
  setVisible(visible: boolean): void;
  setEditMode(editing: boolean): void;
}

export function readAppState(source: AppStateSource): AppState {
  return { overlaysVisible: source.isVisible, overlaysLocked: !source.isEditMode };
}

/**
 * Returns the function to call on every manager state change (tray, shortcut or window): it
 * refreshes the tray and sends `app-state:changed` when the state really changed.
 */
export function createAppStateNotifier(
  source: AppStateSource,
  send: (channel: string, state: AppState) => void,
  refreshTray: () => void,
): () => void {
  let last: AppState | undefined;
  return () => {
    refreshTray();
    const state = readAppState(source);
    if (last && last.overlaysVisible === state.overlaysVisible) {
      if (last.overlaysLocked === state.overlaysLocked) return;
    }
    last = state;
    send(IPC.appStateChanged, state);
  };
}

export interface AppStateDeps {
  source: () => AppStateSource | undefined;
  quit(): void;
}

/**
 * `app-state:get`, `app-state:set` and `app:quit`. Main-window-only: other senders are denied.
 * A set applies only the booleans present in the patch.
 */
export function createAppStateIpcHandlers(
  ctx: IpcContext,
  deps: AppStateDeps,
): Record<string, Handler> {
  const guard = (channel: string, sender: Sender): void => {
    if (!ctx.isSettingsSender(sender)) ctx.deny(channel);
  };
  const current = (): AppState => {
    const source = deps.source();
    return source ? readAppState(source) : { overlaysVisible: true, overlaysLocked: true };
  };
  return {
    [IPC.appStateGet]: (event) => {
      guard(IPC.appStateGet, event.sender);
      return current();
    },
    [IPC.appStateSet]: (event, patch) => {
      guard(IPC.appStateSet, event.sender);
      const source = deps.source();
      if (source && typeof patch === "object" && patch !== null) {
        const p = patch as Partial<Record<keyof AppState, unknown>>;
        if (typeof p.overlaysVisible === "boolean" && p.overlaysVisible !== source.isVisible) {
          source.setVisible(p.overlaysVisible);
        }
        if (typeof p.overlaysLocked === "boolean" && p.overlaysLocked === source.isEditMode) {
          source.setEditMode(!p.overlaysLocked);
        }
      }
      return current();
    },
    [IPC.appQuit]: (event) => {
      guard(IPC.appQuit, event.sender);
      deps.quit();
    },
  };
}

export function registerAppStateIpc(ctx: IpcContext, deps: AppStateDeps): void {
  for (const [channel, handler] of Object.entries(createAppStateIpcHandlers(ctx, deps))) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...args));
  }
}
