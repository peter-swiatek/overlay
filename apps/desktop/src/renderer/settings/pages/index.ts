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
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "overlays", label: "Overlays", Component: OverlaysPage },
  { id: "appearance", label: "Appearance", Component: AppearancePage },
  { id: "general", label: "General", Component: GeneralPage },
  { id: "performance", label: "Performance", Component: PerformancePage },
  { id: "display", label: "Display", Component: DisplayPage },
  { id: "developer", label: "Developer", Component: DeveloperPage, devOnly: true },
];
