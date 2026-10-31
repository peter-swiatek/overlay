import type { TelemetryEvent } from "../../shared/telemetry-types";
import type { SettingsPage, SettingsPageId } from "./pages";

/** Developer-only pages are listed only while developer tools are on. */
export function visiblePages(
  pages: readonly SettingsPage[],
  developerEnabled: boolean,
): SettingsPage[] {
  return pages.filter((p) => !p.devOnly || developerEnabled);
}

/** The remembered page if it is still visible, else the first visible one. */
export function resolvePageId(
  pages: readonly SettingsPage[],
  wanted: string | null,
): SettingsPageId | undefined {
  return (pages.find((p) => p.id === wanted) ?? pages[0])?.id;
}

/** The rail's status line. */
export function statusLabel(event: TelemetryEvent | null): string {
  if (event === null) return "Waiting for sim";
  if (event.status === "error") return event.error ?? "Telemetry error";
  if (event.status === "waiting") return "Waiting for sim";
  switch (event.source) {
    case "iracing":
      return "iRacing connected";
    case "lmu":
      return "LMU connected";
    case "replay":
      return "Replay";
    case "mock":
      return "Mock";
    default:
      return "Connected";
  }
}

/** Status dot colour class: ok, idle or error. */
export function statusTone(event: TelemetryEvent | null): "ok" | "idle" | "error" {
  if (event?.status === "error") return "error";
  return event?.status === "live" ? "ok" : "idle";
}

/** CSS zoom for the shell root; 100 % means no zoom. */
export function zoomOf(uiScalePct: number): number {
  return uiScalePct / 100;
}
