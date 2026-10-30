import { release } from "node:os";
import { join } from "node:path";
import { app, shell, utilityProcess, type UtilityProcess } from "electron";
import {
  IDLE_CAPTURE_STATUS,
  type CaptureCommand,
  type CaptureEvent,
  type CaptureSettings,
  type CaptureStatus,
} from "../shared/capture-types";
import type { CaptureSettingsStore } from "./capture-settings";

/** Starts and stops the capture utility process and relays its status. */
export class CaptureManager {
  private child: UtilityProcess | undefined;
  private status: CaptureStatus = { ...IDLE_CAPTURE_STATUS };
  private settings: CaptureSettings;

  constructor(
    private readonly settingsStore: CaptureSettingsStore,
    private readonly onStatus: (status: CaptureStatus) => void,
  ) {
    this.settings = settingsStore.load();
  }

  get fixturesDir(): string {
    return join(app.getPath("userData"), "fixtures");
  }

  get isRecording(): boolean {
    return this.status.recording;
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  getSettings(): CaptureSettings {
    return this.settings;
  }

  setSettings(patch: unknown): CaptureSettings {
    this.settings = this.settingsStore.update(patch);
    this.send({ type: "settings", settings: this.settings });
    return this.settings;
  }

  start(): void {
    if (this.status.recording) return;
    if (!this.child) {
      const child = utilityProcess.fork(join(import.meta.dirname, "capture.js"), [], {
        serviceName: "overlay-capture",
      });
      child.on("message", (event: CaptureEvent) => {
        this.setStatus(event.status);
        if (event.type === "stopped") this.killChild(child);
      });
      child.on("exit", () => {
        if (this.child === child) this.child = undefined;
        if (this.status.recording) {
          this.setStatus({ ...this.status, recording: false, error: "Capture process exited" });
        }
      });
      this.child = child;
    }
    // Optimistic, so the tray flips immediately; the process confirms with its first status.
    this.setStatus({ ...this.status, recording: true, error: null });
    this.send({
      type: "start",
      dir: this.fixturesDir,
      appVersion: app.getVersion(),
      os: `Windows ${release()}`,
      settings: this.settings,
    });
  }

  stop(): void {
    if (!this.child) {
      this.setStatus({ ...this.status, recording: false });
      return;
    }
    this.send({ type: "stop" });
  }

  mark(label: string): void {
    this.send({ type: "marker", label });
  }

  openFolder(): void {
    void shell.openPath(this.fixturesDir);
  }

  /** Stops recording and resolves once the file is finalised (or after 3 s). */
  shutdown(): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.killChild(child);
        resolve();
      }, 3000);
      child.on("message", (event: CaptureEvent) => {
        if (event.type !== "stopped") return;
        clearTimeout(timer);
        resolve();
      });
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.send({ type: "stop" });
    });
  }

  private killChild(child: UtilityProcess): void {
    child.kill();
    if (this.child === child) this.child = undefined;
  }

  private send(command: CaptureCommand): void {
    this.child?.postMessage(command);
  }

  private setStatus(status: CaptureStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
