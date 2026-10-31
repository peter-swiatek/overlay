import type { ThemeState } from "@overlay/theme/types";

export interface ThemeEditorEntryProps {
  state: ThemeState;
  /** Call with the ThemeState each theme IPC call returns. */
  onState(next: ThemeState): void;
}

/** Placeholder: the colour editor arrives with M2-19, which replaces this file. */
export function ThemeEditorEntry(props: ThemeEditorEntryProps): JSX.Element | null {
  void props;
  return null;
}
