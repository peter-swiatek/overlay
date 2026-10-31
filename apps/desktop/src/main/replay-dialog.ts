import { BrowserWindow, dialog } from "electron";
import type { WebContents } from "electron";

/**
 * Asks for a fixture recording to replay; modal to the window that asked, when there is one.
 * Resolves to null when the dialog is cancelled.
 */
export async function pickReplayFile(sender?: WebContents): Promise<string | null> {
  const options = {
    title: "Replay a recording",
    properties: ["openFile" as const],
    filters: [{ name: "Fixture recording", extensions: ["ovfx"] }],
  };
  const parent = sender ? BrowserWindow.fromWebContents(sender) : null;
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) return null;
  return path;
}
