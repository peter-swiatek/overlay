import type { AppSettings } from "../../../shared/app-settings-types";
import { useAppSettings } from "../controls/useAppSettings";

/** The card shows once settings are loaded and until "Got it" has been pressed. */
export function welcomeVisible(settings: AppSettings | null): boolean {
  return settings !== null && !settings.general.welcomeDismissed;
}

export const WELCOME_TEXT =
  "Turn on the overlays you want. Unlock (top bar) to drag and resize them on screen, then lock again. Closing this window keeps them running.";

/** The card itself, separate from the settings hook so it renders with fake props. */
export function WelcomeCard({ onDismiss }: { onDismiss(): void }) {
  return (
    <section className="welcome" aria-label="Welcome">
      <p>{WELCOME_TEXT}</p>
      <button type="button" className="welcome-dismiss" onClick={onDismiss}>
        Got it
      </button>
    </section>
  );
}

/**
 * First-run card for the Overlays page. Shows until "Got it" is pressed, then stays hidden.
 * App.tsx mounts it above the Overlays page; do not mount it a second time inside that page.
 */
export function Welcome() {
  const { settings, update } = useAppSettings();
  if (!welcomeVisible(settings)) return null;
  return <WelcomeCard onDismiss={() => update({ general: { welcomeDismissed: true } })} />;
}
