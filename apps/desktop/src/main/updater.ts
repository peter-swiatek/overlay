import type { BuildChannel } from "../shared/build-info";
import type { UpdateSettingsStorage } from "./update-settings";

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long "Up to date" or an error stays in the tray item. */
export const RESULT_DISPLAY_MS = 5_000;

/** The slice of electron-updater's AppUpdater that this module uses. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: "checking-for-update" | "update-not-available", listener: () => void): unknown;
  on(
    event: "update-available" | "update-downloaded",
    listener: (info: { version: string }) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

export interface UpdaterDeps {
  autoUpdater: AutoUpdaterLike;
  settings: UpdateSettingsStorage;
  channel: BuildChannel;
  isPackaged: boolean;
  /** One-shot timer; returns a cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
  /** Repeating timer; returns a cancel function. */
  setRepeating(fn: () => void, ms: number): () => void;
  /** Called whenever the state or settings change, so the tray can rebuild. */
  onChange(): void;
  log?: (message: string) => void;
}

/** Updates only run for packaged release builds. */
export function updatesEnabled(channel: BuildChannel, isPackaged: boolean): boolean {
  return channel === "release" && isPackaged;
}

export class Updater {
  private state: UpdateState = { kind: "idle" };
  private clearResult: (() => void) | undefined;
  private stops: (() => void)[] = [];
  readonly enabled: boolean;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: UpdaterDeps) {
    this.enabled = updatesEnabled(deps.channel, deps.isPackaged);
    this.log = deps.log ?? ((m) => console.info(`[updater] ${m}`));
  }

  getState(): UpdateState {
    return this.state;
  }

  get allowPrerelease(): boolean {
    return this.deps.settings.load().allowPrerelease;
  }

  /** Wires the updater and schedules checks. Does nothing for dev/local or unpackaged builds. */
  start(): void {
    if (!this.enabled) {
      this.log(`disabled (${this.deps.channel} build, packaged=${String(this.deps.isPackaged)})`);
      return;
    }
    const u = this.deps.autoUpdater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.allowPrerelease = this.allowPrerelease;
    u.on("checking-for-update", () => {
      this.log("checking");
      this.setState({ kind: "checking" });
    });
    u.on("update-available", (info) => {
      this.log(`available v${info.version}`);
      this.setState({ kind: "available", version: info.version });
    });
    u.on("update-not-available", () => {
      this.log("not available");
      this.showTransient({ kind: "up-to-date" });
    });
    u.on("update-downloaded", (info) => {
      this.log(`downloaded v${info.version}`);
      this.setState({ kind: "downloaded", version: info.version });
    });
    u.on("error", (error) => {
      this.log(`error: ${error.message}`);
      this.showTransient({ kind: "error", message: error.message });
    });
    this.stops.push(
      this.deps.setTimer(() => this.checkNow(), FIRST_CHECK_DELAY_MS),
      this.deps.setRepeating(() => this.checkNow(), CHECK_INTERVAL_MS),
    );
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.clearResult?.();
    this.clearResult = undefined;
  }

  /** Starts a check unless one is running or an update is already downloaded. */
  checkNow(): void {
    if (!this.enabled) return;
    const kind = this.state.kind;
    if (kind === "checking" || kind === "available" || kind === "downloaded") return;
    this.deps.autoUpdater.allowPrerelease = this.allowPrerelease;
    this.setState({ kind: "checking" });
    this.deps.autoUpdater.checkForUpdates().catch((error: unknown) => {
      // The "error" event normally fires too; this covers a rejection without one.
      if (this.state.kind !== "checking") return;
      const message = error instanceof Error ? error.message : String(error);
      this.log(`error: ${message}`);
      this.showTransient({ kind: "error", message });
    });
  }

  setAllowPrerelease(value: boolean): void {
    this.deps.settings.update({ allowPrerelease: value });
    this.deps.autoUpdater.allowPrerelease = value;
    this.deps.onChange();
  }

  /** Restarts into the downloaded update. Goes through the normal before-quit path. */
  restartToUpdate(): void {
    if (this.state.kind !== "downloaded") return;
    this.deps.autoUpdater.quitAndInstall(false, true);
  }

  private showTransient(state: UpdateState): void {
    this.setState(state);
    this.clearResult = this.deps.setTimer(() => {
      if (this.state === state) this.setState({ kind: "idle" });
    }, RESULT_DISPLAY_MS);
  }

  private setState(state: UpdateState): void {
    this.clearResult?.();
    this.clearResult = undefined;
    this.state = state;
    this.deps.onChange();
  }
}
