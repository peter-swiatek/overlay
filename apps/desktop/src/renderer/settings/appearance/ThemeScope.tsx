import { lockedCssVars, themeToCssVars } from "@overlay/theme";
import type { Theme } from "@overlay/theme/types";
import type { CSSProperties, ReactNode } from "react";
// Loads the bundled faces into the settings window; see renderer/theme/fonts.css.
import "../../theme/fonts";

/**
 * A container whose inline style carries the theme and locked variables. The settings window
 * is not themed, so every preview lives in one of these and nothing touches :root.
 */
export function ThemeScope({
  theme,
  className,
  children,
}: {
  theme: Theme;
  className?: string;
  children?: ReactNode;
}) {
  const style = { ...themeToCssVars(theme), ...lockedCssVars() } as CSSProperties;
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
