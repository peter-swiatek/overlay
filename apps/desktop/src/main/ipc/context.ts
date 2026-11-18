import type { WebContents } from "electron";

/** What every IPC registration needs to know about the app's windows. */
export interface IpcContext {
  userData: string;
  /**
   * True for the main window. The name is historical (it was the settings window); it keeps the
   * name so the `ipc/*.ts` handlers need no rename.
   */
  isSettingsSender(sender: WebContents): boolean;
  isOverlaySender(sender: WebContents): boolean;
  /** Sends to every open overlay window and the main window. */
  broadcast(channel: string, ...args: unknown[]): void;
  /** Throws the standard "Rejected IPC from unexpected sender" error. */
  deny(channel: string): never;
}
