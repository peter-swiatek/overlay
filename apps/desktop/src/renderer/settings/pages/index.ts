import type { ComponentType } from "react";
import { AppearancePage } from "./AppearancePage";
import { DeveloperPage } from "./DeveloperPage";
import { DisplayPage } from "./DisplayPage";
import { GeneralPage } from "./GeneralPage";
import { OverlaysPage } from "./OverlaysPage";
import { PerformancePage } from "./PerformancePage";

export type SettingsPageId =
  "overlays" | "appearance" | "general" | "performance" | "display" | "developer";

export interface SettingsPage {
  id: SettingsPageId;
  label: string;
  Component: ComponentType;
  devOnly?: boolean;
  /** Rail group: "main" pages sit at the top, "settings" pages under the Settings heading. */
  group: "main" | "settings";
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "overlays", label: "Overlays", Component: OverlaysPage, group: "main" },
  { id: "appearance", label: "Appearance", Component: AppearancePage, group: "main" },
  { id: "general", label: "General", Component: GeneralPage, group: "settings" },
  { id: "performance", label: "Performance", Component: PerformancePage, group: "settings" },
  { id: "display", label: "Display", Component: DisplayPage, group: "settings" },
  {
    id: "developer",
    label: "Developer",
    Component: DeveloperPage,
    devOnly: true,
    group: "settings",
  },
];
