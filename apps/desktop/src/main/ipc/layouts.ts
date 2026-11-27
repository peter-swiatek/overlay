import { ipcMain } from "electron";
import type { LayoutsState } from "../../shared/layout-types";
import { IPC } from "../../shared/types";
import type { LayoutSwitcher } from "../layout-switcher";
import type { IpcContext } from "./context";

type Sender = Electron.WebContents;
type Handler = (event: { sender: Sender }, ...args: unknown[]) => LayoutsState;
type Senders = Pick<IpcContext, "isSettingsSender" | "deny">;

/** The `layouts:*` handlers as plain functions (main window only), so tests need no Electron. */
export function createLayoutIpcHandlers(
  ctx: Senders,
  switcher: LayoutSwitcher,
): Record<string, Handler> {
  /** Checks the sender, runs `act` when the arguments are valid and returns the new state. */
  const handle =
    (channel: string, act: (...args: unknown[]) => void): Handler =>
    (event, ...args) => {
      if (!ctx.isSettingsSender(event.sender)) ctx.deny(channel);
      act(...args);
      return switcher.state();
    };
  const withId =
    (act: (id: string, ...rest: unknown[]) => unknown) =>
    (id: unknown, ...rest: unknown[]): void => {
      if (typeof id === "string") act(id, ...rest);
    };
  return {
    [IPC.layoutsGet]: handle(IPC.layoutsGet, () => undefined),
    [IPC.layoutsActivate]: handle(
      IPC.layoutsActivate,
      withId((id) => switcher.activate(id)),
    ),
    [IPC.layoutsCreate]: handle(IPC.layoutsCreate, () => switcher.create()),
    [IPC.layoutsDuplicate]: handle(
      IPC.layoutsDuplicate,
      withId((id) => switcher.duplicate(id)),
    ),
    [IPC.layoutsRename]: handle(
      IPC.layoutsRename,
      withId((id, name) => switcher.rename(id, name)),
    ),
    [IPC.layoutsRemove]: handle(
      IPC.layoutsRemove,
      withId((id) => switcher.remove(id)),
    ),
    [IPC.layoutsSetMatch]: handle(
      IPC.layoutsSetMatch,
      withId((id, patch) => switcher.setMatch(id, patch)),
    ),
    [IPC.layoutsSetAutoSwitch]: handle(IPC.layoutsSetAutoSwitch, (on) => {
      if (typeof on === "boolean") switcher.setAutoSwitch(on);
    }),
    [IPC.layoutsSetEnabled]: handle(
      IPC.layoutsSetEnabled,
      withId((id, instanceId, on) => {
        if (typeof instanceId === "string" && typeof on === "boolean") {
          switcher.setEnabled(id, instanceId, on);
        }
      }),
    ),
  };
}

export function registerLayoutIpc(ctx: IpcContext, switcher: LayoutSwitcher): void {
  const handlers = createLayoutIpcHandlers(ctx, switcher);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...args));
  }
}
