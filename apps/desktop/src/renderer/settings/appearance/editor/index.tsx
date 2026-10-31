import type { ThemeState } from "@overlay/theme/types";
import { useState } from "react";
import { Button } from "../../controls";
import { ThemeEditorPanel } from "./ThemeEditor";

export interface ThemeEditorEntryProps {
  state: ThemeState;
  /** Call with the ThemeState each theme IPC call returns. */
  onState(next: ThemeState): void;
}

/** "Edit colours" button; the editor opens inline below it and always edits the active theme. */
export function ThemeEditorEntry({ state, onState }: ThemeEditorEntryProps) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="ed-entry">
        <Button onClick={() => setOpen(true)}>Edit colours</Button>
      </div>
    );
  }
  return (
    <div className="ed-entry">
      <ThemeEditorPanel
        state={state}
        api={window.overlayApi.theme}
        onState={onState}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
