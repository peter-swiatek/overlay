import type { ThemeState } from "@overlay/theme/types";
import { useState, type MutableRefObject } from "react";
import { Button } from "../../controls";
import type { ThemeWriter } from "../model";
import { ThemeEditorPanel } from "./ThemeEditor";

export interface ThemeEditorEntryProps {
  state: ThemeState;
  /** Call with the ThemeState each theme IPC call returns. */
  onState(next: ThemeState): void;
  /** The page's shared writer, so editor saves and gallery picks share one queue. */
  writer?: ThemeWriter;
  /** Filled with a function that saves the pending draft (when the editor is open). */
  settleRef?: MutableRefObject<(() => Promise<unknown>) | null>;
}

/** "Edit colours" button; the editor opens inline below it and always edits the active theme. */
export function ThemeEditorEntry({ state, onState, writer, settleRef }: ThemeEditorEntryProps) {
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
        writer={writer}
        settleRef={settleRef}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
