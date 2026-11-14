import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_PRESETS, encodeThemeCode, serializeThemeFile } from "@overlay/theme";
import { IPC } from "../../shared/types";
import { ThemeStore } from "../theme-store";
import type { IpcContext } from "./context";
import { createThemeHandlers, themeFileName, type ThemeIpcDeps } from "./theme";

const settings = { kind: "settings" } as unknown as WebContents;
const overlay = { kind: "overlay" } as unknown as WebContents;
const other = { kind: "other" } as unknown as WebContents;

const ctx: IpcContext = {
  userData: "",
  isSettingsSender: (s) => s === settings,
  isOverlaySender: (s) => s === overlay,
  broadcast: () => undefined,
  deny: (channel) => {
    throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
  },
};

let dir: string;
let store: ThemeStore;
let files: Map<string, string>;
let nextOpen: { canceled: boolean; filePaths: string[] };
let nextSave: { canceled: boolean; filePath?: string };
const dialogSenders: unknown[] = [];
let saveOptions: { defaultPath: string; filters: { name: string; extensions: string[] }[] } | null;

const deps: ThemeIpcDeps = {
  showOpenDialog: async (sender) => {
    dialogSenders.push(sender);
    return nextOpen;
  },
  showSaveDialog: async (_sender, options) => {
    dialogSenders.push(_sender);
    saveOptions = options;
    return nextSave;
  },
  readText: async (path) => {
    const text = files.get(path);
    if (text === undefined) throw new Error("missing");
    return text;
  },
  writeText: async (path, text) => {
    files.set(path, text);
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "theme-ipc-"));
  store = new ThemeStore(join(dir, "themes.json"));
  files = new Map();
  nextOpen = { canceled: true, filePaths: [] };
  nextSave = { canceled: true };
  saveOptions = null;
  dialogSenders.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const handlers = () => createThemeHandlers(ctx, store, deps);
const call = (channel: string, sender: WebContents, ...args: unknown[]) => {
  const handler = handlers()[channel];
  if (!handler) throw new Error(`no handler ${channel}`);
  return handler({ sender }, ...args);
};

describe("theme IPC sender rules", () => {
  const settingsOnly = [
    IPC.themeGetState,
    IPC.themeSetActive,
    IPC.themeSave,
    IPC.themeRemove,
    IPC.themeImportCode,
    IPC.themeExportCode,
    IPC.themeImportFile,
    IPC.themeExportFile,
  ];

  it.each(settingsOnly)("%s accepts only the settings window", async (channel) => {
    await expect(Promise.resolve().then(() => call(channel, overlay, "x"))).rejects.toThrow(
      "Rejected IPC",
    );
    await expect(Promise.resolve().then(() => call(channel, other, "x"))).rejects.toThrow(
      "Rejected IPC",
    );
  });

  it("lets settings and overlay windows read the active theme", () => {
    expect(call(IPC.themeGetActive, settings)).toMatchObject({ id: "graphite" });
    expect(call(IPC.themeGetActive, overlay)).toMatchObject({ id: "graphite" });
    expect(() => call(IPC.themeGetActive, other)).toThrow("Rejected IPC");
  });
});

describe("theme IPC store calls", () => {
  it("ignores non-string ids", () => {
    expect(call(IPC.themeSetActive, settings, 5)).toMatchObject({ activeId: "graphite" });
    expect(call(IPC.themeRemove, settings, {})).toMatchObject({ activeId: "graphite" });
  });

  it("rejects saving a preset", () => {
    expect(() => call(IPC.themeSave, settings, THEME_PRESETS[1])).toThrow();
  });
});

describe("import and export by code", () => {
  it("imports a code as a new custom theme", () => {
    const code = encodeThemeCode({ ...THEME_PRESETS[1]!, name: "Zażółć" });
    const result = call(IPC.themeImportCode, settings, code) as {
      ok: true;
      theme: { id: string; name: string };
      state: { custom: unknown[]; activeId: string };
    };
    expect(result.ok).toBe(true);
    expect(result.theme.id).toMatch(/^custom-/);
    expect(result.theme.name).toBe("Zażółć");
    expect(result.state.custom).toHaveLength(1);
    expect(result.state.activeId).toBe("graphite");
  });

  it("reports bad codes and non-strings", () => {
    expect(call(IPC.themeImportCode, settings, "OVT1.xx")).toMatchObject({ ok: false });
    expect(call(IPC.themeImportCode, settings, 3)).toMatchObject({ ok: false });
  });

  it("exports presets and custom themes, null for unknown ids", () => {
    expect(call(IPC.themeExportCode, settings, "aurora")).toBe(encodeThemeCode(THEME_PRESETS[5]!));
    expect(call(IPC.themeExportCode, settings, "nope")).toBeNull();
    expect(call(IPC.themeExportCode, settings, 4)).toBeNull();
  });
});

describe("import and export by file", () => {
  it("returns null when the open dialog is cancelled", async () => {
    expect(await call(IPC.themeImportFile, settings)).toBeNull();
  });

  it("imports a theme file", async () => {
    files.set("/t.ovtheme.json", serializeThemeFile(THEME_PRESETS[2]!));
    nextOpen = { canceled: false, filePaths: ["/t.ovtheme.json"] };
    const result = await call(IPC.themeImportFile, settings);
    expect(result).toMatchObject({ ok: true, theme: { name: "Carbon" } });
    expect(dialogSenders).toEqual([settings]);
    expect(store.getState().custom).toHaveLength(1);
  });

  it("reports unreadable and invalid files", async () => {
    nextOpen = { canceled: false, filePaths: ["/missing"] };
    expect(await call(IPC.themeImportFile, settings)).toEqual({
      ok: false,
      error: "Could not read that file",
    });
    files.set("/bad", "{}");
    nextOpen = { canceled: false, filePaths: ["/bad"] };
    expect(await call(IPC.themeImportFile, settings)).toMatchObject({ ok: false });
    expect(store.getState().custom).toHaveLength(0);
  });

  it("exports to the chosen path with a default name from the theme", async () => {
    nextSave = { canceled: false, filePath: "/out.ovtheme.json" };
    expect(await call(IPC.themeExportFile, settings, "midnight")).toBe(true);
    expect(dialogSenders).toEqual([settings]);
    expect(saveOptions?.defaultPath).toBe("Midnight.ovtheme.json");
    expect(saveOptions?.filters[0]?.name).toBe("Overlay theme");
    expect(files.get("/out.ovtheme.json")).toContain('"format": "overlay-theme"');
  });

  it("returns false when cancelled, unknown or the write fails", async () => {
    expect(await call(IPC.themeExportFile, settings, "midnight")).toBe(false);
    nextSave = { canceled: false, filePath: "/x" };
    expect(await call(IPC.themeExportFile, settings, "nope")).toBe(false);
    const failing = createThemeHandlers(ctx, store, {
      ...deps,
      writeText: async () => {
        throw new Error("disk full");
      },
    });
    expect(await failing[IPC.themeExportFile]?.({ sender: settings }, "midnight")).toBe(false);
  });
});

describe("themeFileName", () => {
  it("drops forbidden characters", () => {
    expect(themeFileName('A/B:C*"D')).toBe("ABCD.ovtheme.json");
    expect(themeFileName("???")).toBe("theme.ovtheme.json");
    expect(themeFileName("Zażółć")).toBe("Zażółć.ovtheme.json");
  });
});
