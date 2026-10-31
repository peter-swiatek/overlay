import { ipcMain } from "electron";
import type { TelemetrySourceChoice, TelemetrySourceView } from "../../shared/telemetry-types";
import { IPC } from "../../shared/types";
import { pickReplayFile } from "../replay-dialog";
import type { TelemetryManager } from "../telemetry-manager";
import { TELEMETRY_SOURCES, type TelemetrySettings } from "../telemetry-settings";
import type { IpcContext } from "./context";

export function sourceViewOf(settings: TelemetrySettings): TelemetrySourceView {
  return { source: settings.source, replayPath: settings.replayPath };
}

function isChoice(value: unknown): value is Exclude<TelemetrySourceChoice, "replay"> {
  return (
    typeof value === "string" &&
    value !== "replay" &&
    (TELEMETRY_SOURCES as readonly string[]).includes(value)
  );
}

export function registerTelemetryIpc(ctx: IpcContext, telemetry: TelemetryManager): void {
  ipcMain.handle(IPC.telemetryGetSource, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.telemetryGetSource);
    return sourceViewOf(telemetry.getSettings());
  });
  ipcMain.handle(IPC.telemetrySetSource, (event, source: unknown) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.telemetrySetSource);
    if (!isChoice(source)) return sourceViewOf(telemetry.getSettings());
    return sourceViewOf(telemetry.updateSettings({ source }));
  });
  ipcMain.handle(IPC.telemetryPickReplay, async (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.telemetryPickReplay);
    const path = await pickReplayFile();
    if (path === null) return sourceViewOf(telemetry.getSettings());
    return sourceViewOf(telemetry.updateSettings({ source: "replay", replayPath: path }));
  });
  ipcMain.handle(IPC.telemetryGetStatus, (event) => {
    if (!ctx.isSettingsSender(event.sender)) ctx.deny(IPC.telemetryGetStatus);
    return telemetry.getStatus() ?? null;
  });
}
