import type { TelemetryEvent, TelemetrySourceChoice } from "../../shared/telemetry-types";
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

export interface RailGroup {
  id: "main" | "settings";
  /** Heading shown above the group; null for the unlabelled top group. */
  title: string | null;
  pages: SettingsPage[];
}

/** Splits the visible pages into the rail's two groups, dropping a group with no pages. */
export function railGroups(pages: readonly SettingsPage[]): RailGroup[] {
  const groups: RailGroup[] = [
    { id: "main", title: null, pages: pages.filter((p) => p.group === "main") },
    { id: "settings", title: "Settings", pages: pages.filter((p) => p.group === "settings") },
  ];
  return groups.filter((g) => g.pages.length > 0);
}

export interface GameOption {
  value: TelemetrySourceChoice;
  label: string;
}

/**
 * The top bar's game choices. Mock and Replay show only with developer tools on, or while one of
 * them is the current source (so the selected entry is never hidden); same rule as the tray.
 */
export function gameOptions(
  current: TelemetrySourceChoice,
  developerEnabled: boolean,
): GameOption[] {
  const options: GameOption[] = [
    { value: "auto", label: "Auto" },
    { value: "iracing", label: "iRacing" },
    { value: "lmu", label: "LMU" },
  ];
  if (developerEnabled || current === "mock") options.push({ value: "mock", label: "Mock" });
  if (developerEnabled || current === "replay") options.push({ value: "replay", label: "Replay" });
  return options;
}
