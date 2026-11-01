import type { AppSettings } from "../shared/app-settings-types";

/** What to do at process start. */
export interface LaunchPlan {
  /** False means start hidden in the tray with no window. */
  showWindow: boolean;
}

/** The flag the login item is registered with (`app.setLoginItemSettings({ args })`). */
export const HIDDEN_ARG = "--hidden";

/**
 * Pure: decides whether the main window opens at start. Windows does not report
 * `wasOpenedAtLogin`, so the `--hidden` argument is the signal. Starting by hand (no flag)
 * always shows the window. Owned by MW-1; this stub always shows it.
 *
 * @param argv process.argv
 * @param settings stored app settings (`general.startHiddenAtLogin`)
 */
export function launchPlan(argv: readonly string[], settings: AppSettings): LaunchPlan {
  void argv;
  void settings;
  return { showWindow: true };
}
