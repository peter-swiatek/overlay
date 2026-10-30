import { join } from "node:path";
import { BrowserWindow, app, globalShortcut, ipcMain, type WebContents } from "electron";
import { IPC, type AppInfo } from "../shared/types";
import { LayoutStore } from "./layout-store";
import { summarizeMetrics } from "./metrics";
import { OverlayManager } from "./overlays";
import { loadPage, preloadPath } from "./pages";
import { SettingsStore, isSafeMode, resolveDisplaySettings } from "./settings";
import { AppTray } from "./tray";
import { buildSettingsWindowOptions } from "./window-options";

const EDIT_SHORTCUT = "Control+Shift+F10";

// Display fallbacks must be applied before app is ready, so read them synchronously now.
const userData = app.getPath("userData");
const settingsStore = new SettingsStore(join(userData, "settings.json"));
const safeMode = isSafeMode(process.argv);
const stored = settingsStore.load();
const effective = resolveDisplaySettings(stored, safeMode);

if (effective.disableHardwareAcceleration) app.disableHardwareAcceleration();
if (effective.disableDirectComposition) app.commandLine.appendSwitch("disable-direct-composition");

let settingsWindow: BrowserWindow | undefined;
let overlays: OverlayManager | undefined;
let tray: AppTray | undefined;

function showSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const win = new BrowserWindow(buildSettingsWindowOptions(preloadPath));
  settingsWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    settingsWindow = undefined;
  });
  void loadPage(win, "settings");
}

function fromSettings(sender: WebContents): boolean {
  return !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.webContents === sender;
}

function fromOverlay(sender: WebContents): boolean {
  return overlays?.isOverlaySender(sender) ?? false;
}

function deny(channel: string): never {
  throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
}

function registerIpc(): void {
  ipcMain.handle(IPC.getAppInfo, (event): AppInfo => {
    if (!fromSettings(event.sender)) deny(IPC.getAppInfo);
    return { version: app.getVersion(), display: settingsStore.load(), effective, safeMode };
  });
  ipcMain.handle(IPC.setDisplaySettings, (event, patch: unknown) => {
    if (!fromSettings(event.sender)) deny(IPC.setDisplaySettings);
    return settingsStore.update(patch);
  });
  ipcMain.handle(IPC.getMetrics, (event) => {
    if (!fromSettings(event.sender)) deny(IPC.getMetrics);
    return summarizeMetrics(app.getAppMetrics());
  });
  ipcMain.handle(IPC.getEditMode, (event) => {
    if (!fromOverlay(event.sender)) deny(IPC.getEditMode);
    return overlays?.isEditMode ?? false;
  });
  ipcMain.on(IPC.resizeBy, (event, dx: unknown, dy: unknown) => {
    if (!fromOverlay(event.sender)) return;
    if (typeof dx === "number" && typeof dy === "number") {
      overlays?.resizeFromSender(event.sender, dx, dy);
    }
  });
}

// Renderers only ever show our own pages: no new windows, no navigation away.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showSettings());

  void app.whenReady().then(() => {
    registerIpc();

    const manager = new OverlayManager(
      new LayoutStore(join(userData, "layout.json")),
      effective.opacityWorkaround,
      () => tray?.refresh(),
    );
    overlays = manager;
    manager.start();

    tray = new AppTray(manager, { showSettings, quit: () => app.quit() });

    if (!globalShortcut.register(EDIT_SHORTCUT, () => manager.toggleEditMode())) {
      console.warn(`Could not register ${EDIT_SHORTCUT}`);
    }
  });

  // Tray app: closing the settings window must not quit.
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    overlays?.flushSave();
  });
}
