import { join } from "node:path";
import {
  BrowserWindow,
  screen,
  MessageChannelMain,
  app,
  globalShortcut,
  ipcMain,
  utilityProcess,
  type WebContents,
} from "electron";
import pkg from "electron-updater";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { BUILD_INFO } from "../shared/build-info";
import { IPC } from "../shared/types";
import { AppSettingsStore } from "./app-settings";
import { CaptureManager } from "./capture-manager";
import { CaptureSettingsStore } from "./capture-settings";
import { registerAppSettingsIpc } from "./ipc/app-settings";
import { createAppStateNotifier, registerAppStateIpc } from "./ipc/app-state";
import type { TelemetryEvent } from "../shared/telemetry-types";
import type { IpcContext } from "./ipc/context";
import { registerDeveloperIpc } from "./ipc/developer";
import { registerDisplayIpc } from "./ipc/display";
import { overlaySizes, registerOverlayIpc } from "./ipc/overlays";
import { registerTelemetryIpc, sourceViewOf } from "./ipc/telemetry";
import { registerThemeIpc } from "./ipc/theme";
import { LayoutStore } from "./layout-store";
import {
  TRAY_NOTICE,
  clampMainWindowState,
  decideClose,
  launchPlan,
  loadMainWindowState,
  revealMainWindow,
  saveMainWindowState,
  shouldMinimiseOnConnect,
} from "./main-window";
import { OverlayManager } from "./overlays";
import { OverlaySettingsStore } from "./overlay-settings-store";
import { loadPage, preloadPath } from "./pages";
import {
  SettingsStore,
  buildCommandLineSwitches,
  isSafeMode,
  resolveDisplaySettings,
} from "./settings";
import { recorderForkArgs } from "../recorder/args";
import { TelemetryManager } from "./telemetry-manager";
import { TelemetrySettingsStore } from "./telemetry-settings";
import { ThemeStore } from "./theme-store";
import { AppTray } from "./tray";
import { UpdateSettingsStore } from "./update-settings";
import { Updater } from "./updater";
import { buildMainWindowOptions } from "./window-options";
import { ZOrderKeeper, hwndOf } from "./zorder";

const EDIT_SHORTCUT = "Control+Shift+F10";

console.info(
  `[overlay] version ${BUILD_INFO.displayVersion} (${BUILD_INFO.channel}, built ${BUILD_INFO.buildDate})`,
);

// Display fallbacks must be applied before app is ready, so read them synchronously now.
const userData = app.getPath("userData");
const settingsStore = new SettingsStore(join(userData, "settings.json"));
const safeMode = isSafeMode(process.argv);
const stored = settingsStore.load();
const effective = resolveDisplaySettings(stored, safeMode);

if (effective.disableHardwareAcceleration) app.disableHardwareAcceleration();
for (const { name, value } of buildCommandLineSwitches(effective)) {
  if (value === undefined) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}

let mainWindow: BrowserWindow | undefined;
let lastTelemetryStatus: TelemetryEvent["status"] | null = null;
let appSettings: AppSettingsStore | undefined;
/** True once the app is quitting, so closing the main window really closes it. */
let quitting = false;
let overlays: OverlayManager | undefined;
let tray: AppTray | undefined;
let capture: CaptureManager | undefined;
let telemetry: TelemetryManager | undefined;
let updater: Updater | undefined;
let overlaySettings: OverlaySettingsStore | undefined;
let shuttingDown = false;
/** Set once the overlay manager exists; refreshes the tray and tells the windows. */
let notifyAppState: () => void = () => {};
let lastRecording = false;
let lastCaptureError: string | null = null;
let zorder: ZOrderKeeper | undefined;

const MAIN_WINDOW_FILE = join(userData, "main-window.json");

function saveMainWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return;
  const maximized = win.isMaximized();
  const { x, y, width, height } = win.getNormalBounds();
  saveMainWindowState(MAIN_WINDOW_FILE, { x, y, width, height, maximized });
}

/** Creates the main window if needed, then restores, shows and focuses it. */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const state = clampMainWindowState(
    loadMainWindowState(MAIN_WINDOW_FILE),
    areas,
    screen.getPrimaryDisplay().workArea,
  );
  const win = new BrowserWindow(buildMainWindowOptions(preloadPath, state));
  mainWindow = win;
  win.once("ready-to-show", () => revealMainWindow(win, state.maximized));
  let saveTimer: NodeJS.Timeout | undefined;
  const scheduleSave = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveMainWindowBounds(win), 500);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", (event) => {
    clearTimeout(saveTimer);
    saveMainWindowBounds(win);
    const settings = appSettings?.load();
    const decision = decideClose({
      closeAction: settings?.general.closeAction ?? "tray",
      quitting: quitting || shuttingDown,
      trayNoticeShown: settings?.ui.trayNoticeShown ?? true,
    });
    if (decision.hide) {
      event.preventDefault();
      win.hide();
      if (decision.showNotice) {
        tray?.showNotice(TRAY_NOTICE.title, TRAY_NOTICE.content);
        appSettings?.update({ ui: { trayNoticeShown: true } });
      }
    } else if (decision.quit) {
      app.quit();
    }
  });
  // Windows log-off or shutdown: let the window close instead of hiding it to the tray.
  win.on("session-end", () => {
    quitting = true;
  });
  win.on("closed", () => {
    clearTimeout(saveTimer);
    mainWindow = undefined;
  });
  void loadPage(win, "settings");
}

function fromMain(sender: WebContents): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents === sender;
}

/** Sends to the main window only (when it exists). */
function sendToMain(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function fromOverlay(sender: WebContents): boolean {
  return overlays?.isOverlaySender(sender) ?? false;
}

function deny(channel: string): never {
  throw new Error(`Rejected IPC from unexpected sender: ${channel}`);
}

/** Sends to every open overlay window and the main window. */
function broadcast(channel: string, ...args: unknown[]): void {
  const targets = [...(overlays?.getWindows() ?? [])];
  if (mainWindow) targets.push(mainWindow);
  for (const win of targets) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

function registerIpc(): void {
  ipcMain.on(IPC.telemetrySubscribe, (event, rateHz: unknown) => {
    // Silently ignores senders that are not overlay windows.
    telemetry?.handleSubscribe(event.sender, rateHz);
  });
  ipcMain.handle(IPC.getEditMode, (event) => {
    if (!fromOverlay(event.sender)) deny(IPC.getEditMode);
    return overlays?.isEditMode ?? false;
  });
  ipcMain.on(IPC.contentMinSize, (event, size: unknown) => {
    if (!fromOverlay(event.sender)) return;
    overlays?.setContentMinFromSender(event.sender, size);
  });
  ipcMain.on(IPC.tableMetrics, (event, payload: unknown) => {
    if (!fromOverlay(event.sender)) return;
    overlays?.setTableMetricsFromSender(event.sender, payload);
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
  // A reloaded or crashed page has lost its ports; it asks again when it is back.
  contents.on("did-start-loading", () => telemetry?.forgetWindow(contents));
  contents.on("render-process-gone", () => telemetry?.forgetWindow(contents));
  contents.on("destroyed", () => telemetry?.forgetWindow(contents));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) showMainWindow();
  });

  void app.whenReady().then(() => {
    overlaySettings = new OverlaySettingsStore(
      join(userData, "overlay-settings.json"),
      OVERLAY_MANIFESTS,
    );
    const appSettingsStore = new AppSettingsStore(join(userData, "app-settings.json"));
    appSettings = appSettingsStore;
    const themes = new ThemeStore(join(userData, "themes.json"));
    const ctx: IpcContext = {
      userData,
      isSettingsSender: fromMain,
      isOverlaySender: fromOverlay,
      broadcast,
      deny,
    };
    registerIpc();
    registerOverlayIpc(ctx, overlaySettings, () => overlays?.getLayout() ?? {});
    registerAppStateIpc(ctx, {
      source: () => overlays,
      quit: () => app.quit(),
    });
    registerThemeIpc(ctx, themes);
    registerAppSettingsIpc(ctx, appSettingsStore);
    registerDisplayIpc(ctx, {
      settingsStore,
      effective,
      safeMode,
      isPackaged: app.isPackaged,
      relaunch: (args) => app.relaunch({ args }),
      quit: () => app.quit(),
    });
    registerDeveloperIpc(ctx, {
      getCapture: () => capture,
      getAppMetrics: () => app.getAppMetrics(),
      allOverlayIds: OVERLAY_MANIFESTS.map((m) => m.id),
      setOverlayOverride: (override) => overlays?.setEnabledOverride(override),
      getSourceLabel: () => telemetry?.getSettings().source ?? "unknown",
    });
    let developerWas = appSettingsStore.load().developer.enabled;
    appSettingsStore.onChange((next) => {
      tray?.refresh();
      if (next.developer.enabled !== developerWas) {
        developerWas = next.developer.enabled;
        overlays?.refreshDeveloperMode();
      }
    });

    const manager = new OverlayManager({
      layoutStore: new LayoutStore(join(userData, "layout.json")),
      overlaySettings,
      manifests: OVERLAY_MANIFESTS,
      opacityWorkaround: effective.opacityWorkaround,
      onStateChange: () => notifyAppState(),
      onLayoutSaved: () => {
        if (overlays) sendToMain(IPC.overlaysSizesChanged, overlaySizes(overlays.getLayout()));
      },
      isDeveloperEnabled: () => appSettingsStore.load().developer.enabled,
    });
    overlays = manager;
    notifyAppState = createAppStateNotifier(
      manager,
      (channel, state) => broadcast(channel, state),
      () => tray?.refresh(),
    );
    manager.start();

    capture = new CaptureManager(
      new CaptureSettingsStore(join(userData, "capture-settings.json")),
      (status) => {
        // The menu only depends on these two; skip the rebuild on routine updates.
        if (status.recording !== lastRecording || status.error !== lastCaptureError) {
          lastRecording = status.recording;
          lastCaptureError = status.error;
          tray?.refresh();
        }
        sendToMain(IPC.captureStatusChanged, status);
      },
    );

    // Windows only: keep overlays above sims that re-assert their own z-order when activated.
    const keeper = new ZOrderKeeper({
      getOverlays: () => manager.getWindows(),
      getOwnHandles: () => BrowserWindow.getAllWindows().map((w) => hwndOf(w)),
      loadNative:
        process.platform === "win32"
          ? async (onForeground) => (await import("./zorder-win32")).loadWin32ZOrder(onForeground)
          : undefined,
    });
    zorder = keeper;
    manager.onShouldRaise = () => keeper.requestRaise();
    void keeper.start();

    const telemetryStore = new TelemetrySettingsStore(join(userData, "telemetry-settings.json"));
    telemetry = new TelemetryManager(telemetryStore, {
      fork: () =>
        utilityProcess.fork(
          join(import.meta.dirname, "telemetry.js"),
          recorderForkArgs({
            userData,
            retentionDays: telemetryStore.load().retentionDays,
            // Debug aid: a replay normally never records, so recordings do not record themselves.
            recordSynthetic: process.env["OVERLAY_RECORD_REPLAY"] === "1",
          }),
          { serviceName: "overlay-telemetry" },
        ),
      createChannel: () => new MessageChannelMain(),
      postPortToRenderer: (sender, port) => {
        const contents = sender as WebContents;
        if (!contents.isDestroyed()) {
          contents.postMessage(IPC.telemetryPort, null, [port as Electron.MessagePortMain]);
        }
      },
      isOverlaySender: (sender) => fromOverlay(sender as WebContents),
      nowMs: () => Date.now(),
      setTimer: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      onSettingsChange: (settings) => {
        tray?.refresh();
        // Carries the replay path: main window only.
        sendToMain(IPC.telemetrySourceChanged, sourceViewOf(settings));
      },
      onStatusChange: (status) => {
        broadcast(IPC.telemetryStatusChanged, status);
        if (
          shouldMinimiseOnConnect({
            previous: lastTelemetryStatus,
            next: status.status,
            enabled: appSettings?.load().general.minimiseOnConnect === true,
          }) &&
          mainWindow &&
          !mainWindow.isDestroyed() &&
          mainWindow.isVisible()
        ) {
          mainWindow.minimize();
        }
        lastTelemetryStatus = status.status;
      },
    });
    registerTelemetryIpc(ctx, telemetry);
    // The Fuel overlay's "Keep fuel data" option reaches the telemetry process through the manager.
    const keepFuelData = (s: { options: Record<string, unknown> } | undefined): boolean =>
      s?.options["keep-fuel-data"] === true;
    telemetry.setFuelOptions({ keepFuelData: keepFuelData(overlaySettings.get("fuel")) });
    overlaySettings.onChange((id, s) => {
      if (id === "fuel") telemetry?.setFuelOptions({ keepFuelData: keepFuelData(s) });
    });
    telemetry.start();

    updater = new Updater({
      getAutoUpdater: () => pkg.autoUpdater,
      prepareToQuit: async () => {
        shuttingDown = true;
        quitting = true;
        // The installer stops our processes shortly after it starts: finish the recordings first.
        await Promise.allSettled([telemetry?.shutdown(), capture?.shutdown()]);
        overlays?.flushSave();
        overlaySettings?.flush();
      },
      settings: new UpdateSettingsStore(join(userData, "updates.json")),
      channel: BUILD_INFO.channel,
      isPackaged: app.isPackaged,
      setTimer: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      setRepeating: (fn, ms) => {
        const timer = setInterval(fn, ms);
        return () => clearInterval(timer);
      },
      onChange: () => tray?.refresh(),
    });

    tray = new AppTray(
      manager,
      capture,
      telemetry,
      updater,
      {
        showMainWindow,
        quit: () => app.quit(),
      },
      appSettingsStore,
    );
    updater.start();

    if (!globalShortcut.register(EDIT_SHORTCUT, () => manager.toggleEditMode())) {
      console.warn(`Could not register ${EDIT_SHORTCUT}`);
    }

    // A start by hand shows the window; a login start (--hidden) stays in the tray.
    if (launchPlan(process.argv, appSettingsStore.load()).showWindow) showMainWindow();
  });

  // Tray app: closing the main window hides it (see its close handler); it must not quit.
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    quitting = true;
    if (shuttingDown) return;
    // Both child processes finish their files (the telemetry recorder's last rows and footer, the
    // capture file's gzip trailer and summary) before the app exits.
    const waits: Promise<void>[] = [];
    if (telemetry?.isRunning) waits.push(telemetry.shutdown());
    else void telemetry?.shutdown();
    if (capture?.isRecording) waits.push(capture.shutdown());
    if (waits.length === 0) return;
    shuttingDown = true;
    event.preventDefault();
    void Promise.allSettled(waits).finally(() => app.quit());
  });
  app.on("will-quit", () => {
    updater?.stop();
    globalShortcut.unregisterAll();
    zorder?.dispose();
    overlays?.flushSave();
    overlaySettings?.flush();
  });
}
