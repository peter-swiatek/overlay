import { cpus } from "node:os";
import { join } from "node:path";
import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import type { PerfCheckOutcome } from "../../shared/perf-types";
import type { CaptureManager } from "../capture-manager";
import { writeJsonFileAtomic } from "../json-file";
import { summarizeMetrics } from "../metrics";
import { abortableSleep, resultFileName, runPerfCheck } from "../perf-check";
import type { IpcContext } from "./context";

export interface DeveloperIpcDeps {
  /** Lazy: the capture manager is created after IPC registration. */
  getCapture(): CaptureManager | undefined;
  getAppMetrics(): Electron.ProcessMetric[];
  /** Every overlay id the manager knows. */
  allOverlayIds: readonly string[];
  /** Lazy: opens or closes overlays in memory only (null restores the stored states). */
  setOverlayOverride(override: Record<string, boolean> | null): void;
  /** The telemetry source in use, for the saved result. */
  getSourceLabel(): string;
}

export function registerDeveloperIpc(ctx: IpcContext, deps: DeveloperIpcDeps): void {
  let perfAbort: AbortController | undefined;
  ipcMain.handle(IPC.perfStart, async (event): Promise<PerfCheckOutcome> => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.perfStart);
    if (perfAbort) return { status: "error", error: "A CPU check is already running." };
    const abort = new AbortController();
    perfAbort = abort;
    try {
      const outcome = await runPerfCheck(
        {
          cores: cpus().length,
          source: deps.getSourceLabel(),
          allOverlayIds: deps.allOverlayIds,
          getMetrics: () => deps.getAppMetrics(),
          setOverride: (o) => deps.setOverlayOverride(o),
          sleep: abortableSleep,
          now: () => new Date(),
          onProgress: (p) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC.perfProgress, p);
          },
        },
        abort.signal,
      );
      if (outcome.status === "done") {
        const file = join(ctx.userData, "perf", resultFileName(new Date()));
        try {
          writeJsonFileAtomic(file, outcome.result);
          outcome.result.file = file;
        } catch (error) {
          console.error("Could not save the CPU check result", error);
        }
      }
      return outcome;
    } finally {
      perfAbort = undefined;
    }
  });
  ipcMain.handle(IPC.perfCancel, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.perfCancel);
    perfAbort?.abort();
  });
  ipcMain.handle(IPC.getMetrics, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getMetrics);
    return summarizeMetrics(deps.getAppMetrics());
  });
  ipcMain.handle(IPC.getCaptureStatus, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getCaptureStatus);
    return deps.getCapture()?.getStatus();
  });
  ipcMain.handle(IPC.getCaptureSettings, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.getCaptureSettings);
    return deps.getCapture()?.getSettings();
  });
  ipcMain.handle(IPC.setCaptureSettings, (event, patch: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.setCaptureSettings);
    return deps.getCapture()?.setSettings(patch);
  });
}
