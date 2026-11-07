import { ipcMain, type WebContents } from "electron";
import type {
  TelemetryEvent,
  TelemetrySourceChoice,
  TelemetrySourceView,
} from "../../shared/telemetry-types";
import { IPC } from "../../shared/types";
import type { TelemetryManager } from "../telemetry-manager";
import { pickReplayFile } from "../replay-dialog";
import { TELEMETRY_SOURCES, type TelemetrySettings } from "../telemetry-settings";
import type { IpcContext } from "./context";

export function sourceViewOf(settings: TelemetrySettings): TelemetrySourceView {
  return { source: settings.source, replayPath: settings.replayPath };
}

export function isSettableSource(
  value: unknown,
): value is Exclude<TelemetrySourceChoice, "replay"> {
  return (
    typeof value === "string" &&
    value !== "replay" &&
    (TELEMETRY_SOURCES as readonly string[]).includes(value)
  );
}

export interface TelemetryIpcDeps {
  getSettings(): TelemetrySettings;
  updateSettings(patch: Partial<TelemetrySettings>): TelemetrySettings;
  getStatus(): TelemetryEvent | undefined;
  pickReplayFile(sender: WebContents): Promise<string | null>;
}

type Handler = (sender: WebContents, ...args: unknown[]) => unknown;

/** The pure handlers, keyed by channel; every one is for the settings window only. */
export function telemetryHandlers(
  ctx: Pick<IpcContext, "isSettingsSender" | "deny">,
  deps: TelemetryIpcDeps,
): Record<string, Handler> {
  const guard = (channel: string, sender: WebContents): void => {
    if (!ctx.isSettingsSender(sender)) ctx.deny(channel);
  };
  return {
    [IPC.telemetryGetSource]: (sender) => {
      guard(IPC.telemetryGetSource, sender);
      return sourceViewOf(deps.getSettings());
    },
    [IPC.telemetrySetSource]: (sender, source) => {
      guard(IPC.telemetrySetSource, sender);
      if (!isSettableSource(source)) return sourceViewOf(deps.getSettings());
      return sourceViewOf(deps.updateSettings({ source }));
    },
    [IPC.telemetryPickReplay]: async (sender) => {
      guard(IPC.telemetryPickReplay, sender);
      const path = await deps.pickReplayFile(sender);
      if (path === null) return sourceViewOf(deps.getSettings());
      return sourceViewOf(deps.updateSettings({ source: "replay", replayPath: path }));
    },
    [IPC.telemetryGetStatus]: (sender) => {
      guard(IPC.telemetryGetStatus, sender);
      return deps.getStatus() ?? null;
    },
  };
}

export function registerTelemetryIpc(ctx: IpcContext, telemetry: TelemetryManager): void {
  const handlers = telemetryHandlers(ctx, {
    getSettings: () => telemetry.getSettings(),
    updateSettings: (patch) => telemetry.updateSettings(patch),
    getStatus: () => telemetry.getStatus(),
    pickReplayFile,
  });
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event.sender, ...args));
  }
}
