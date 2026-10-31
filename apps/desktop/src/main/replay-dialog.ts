import { dialog } from "electron";

/** Asks for a fixture recording to replay. Resolves to null when the dialog is cancelled. */
export async function pickReplayFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Replay a recording",
    properties: ["openFile"],
    filters: [{ name: "Fixture recording", extensions: ["ovfx"] }],
  });
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) return null;
  return path;
}
