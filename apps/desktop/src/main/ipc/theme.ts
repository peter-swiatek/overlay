import { readFile, stat, writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { WebContents } from "electron";
import {
  decodeThemeCode,
  encodeThemeCode,
  parseThemeFile,
  serializeThemeFile,
  MAX_THEME_FILE_BYTES,
} from "@overlay/theme";
import type { Theme, ThemeImportResult } from "@overlay/theme/types";
import { IPC } from "../../shared/types";
import type { ThemeStore } from "../theme-store";
import type { IpcContext } from "./context";

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** The file system and dialogs the file import and export need; injected so tests need no Electron. */
export interface ThemeIpcDeps {
  showOpenDialog(
    sender: WebContents,
    options: {
      title: string;
      filters: FileFilter[];
    },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(
    sender: WebContents,
    options: {
      title: string;
      defaultPath: string;
      filters: FileFilter[];
    },
  ): Promise<{ canceled: boolean; filePath?: string }>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
}

export const THEME_FILE_FILTER: FileFilter = {
  name: "Overlay theme",
  extensions: ["ovtheme.json"],
};

export const electronThemeIpcDeps: ThemeIpcDeps = {
  // Modal to the asking window so the dialog cannot hide behind it.
  showOpenDialog: (sender, options) => {
    const full = { ...options, properties: ["openFile" as const] };
    const parent = BrowserWindow.fromWebContents(sender);
    return parent ? dialog.showOpenDialog(parent, full) : dialog.showOpenDialog(full);
  },
  showSaveDialog: (sender, options) => {
    const parent = BrowserWindow.fromWebContents(sender);
    return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
  },
  readText: async (path) => {
    // A theme file is at most 64 KB; refuse to load anything bigger.
    if ((await stat(path)).size > MAX_THEME_FILE_BYTES) throw new Error("File too big");
    return readFile(path, "utf8");
  },
  writeText: (path, text) => writeFile(path, text, "utf8"),
};

export type ThemeHandler = (event: { sender: WebContents }, ...args: unknown[]) => unknown;

/** "My theme" becomes "My theme.ovtheme.json"; characters Windows forbids are dropped. */
export function themeFileName(name: string): string {
  const stem = name
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .replace(/\.+$/, "");
  return `${stem === "" ? "theme" : stem}.ovtheme.json`;
}

function findTheme(store: ThemeStore, id: unknown): Theme | undefined {
  if (typeof id !== "string") return undefined;
  const state = store.getState();
  return [...state.presets, ...state.custom].find((t) => t.id === id);
}

/** Saves an imported theme (already given a fresh id) and reports the result. */
function importTheme(store: ThemeStore, theme: Theme): ThemeImportResult {
  try {
    const state = store.save(theme);
    return { ok: true, theme, state };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not import this theme",
    };
  }
}

/** Channel to handler. Pure: sender checks, argument checks and store calls only. */
export function createThemeHandlers(
  ctx: IpcContext,
  store: ThemeStore,
  deps: ThemeIpcDeps,
): Record<string, ThemeHandler> {
  const settingsOnly = (sender: WebContents, channel: string): void => {
    if (!ctx.isSettingsSender(sender)) ctx.deny(channel);
  };

  return {
    [IPC.themeGetState]: (event) => {
      settingsOnly(event.sender, IPC.themeGetState);
      return store.getState();
    },
    [IPC.themeGetActive]: (event) => {
      if (!ctx.isSettingsSender(event.sender) && !ctx.isOverlaySender(event.sender)) {
        ctx.deny(IPC.themeGetActive);
      }
      return store.getActive();
    },
    [IPC.themeSetActive]: (event, id) => {
      settingsOnly(event.sender, IPC.themeSetActive);
      return typeof id === "string" ? store.setActive(id) : store.getState();
    },
    [IPC.themeSave]: (event, theme) => {
      settingsOnly(event.sender, IPC.themeSave);
      return store.save(theme);
    },
    [IPC.themeRemove]: (event, id) => {
      settingsOnly(event.sender, IPC.themeRemove);
      return typeof id === "string" ? store.remove(id) : store.getState();
    },
    [IPC.themeImportCode]: (event, code): ThemeImportResult => {
      settingsOnly(event.sender, IPC.themeImportCode);
      if (typeof code !== "string") return { ok: false, error: "This is not a theme code" };
      const decoded = decodeThemeCode(code);
      return decoded.ok ? importTheme(store, decoded.theme) : decoded;
    },
    [IPC.themeExportCode]: (event, id): string | null => {
      settingsOnly(event.sender, IPC.themeExportCode);
      const theme = findTheme(store, id);
      return theme ? encodeThemeCode(theme) : null;
    },
    [IPC.themeImportFile]: async (event): Promise<ThemeImportResult | null> => {
      settingsOnly(event.sender, IPC.themeImportFile);
      const picked = await deps.showOpenDialog(event.sender, {
        title: "Import theme",
        filters: [THEME_FILE_FILTER],
      });
      const path = picked.filePaths[0];
      if (picked.canceled || path === undefined) return null;
      let text: string;
      try {
        text = await deps.readText(path);
      } catch {
        return { ok: false, error: "Could not read that file" };
      }
      const parsed = parseThemeFile(text);
      return parsed.ok ? importTheme(store, parsed.theme) : parsed;
    },
    [IPC.themeExportFile]: async (event, id): Promise<boolean> => {
      settingsOnly(event.sender, IPC.themeExportFile);
      const theme = findTheme(store, id);
      if (!theme) return false;
      const picked = await deps.showSaveDialog(event.sender, {
        title: "Export theme",
        defaultPath: themeFileName(theme.name),
        filters: [THEME_FILE_FILTER],
      });
      if (picked.canceled || picked.filePath === undefined) return false;
      try {
        await deps.writeText(picked.filePath, serializeThemeFile(theme));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function registerThemeIpc(
  ctx: IpcContext,
  store: ThemeStore,
  deps: ThemeIpcDeps = electronThemeIpcDeps,
): void {
  for (const [channel, handler] of Object.entries(createThemeHandlers(ctx, store, deps))) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...args));
  }
  store.onChange((active) => ctx.broadcast(IPC.themeChanged, active));
}
