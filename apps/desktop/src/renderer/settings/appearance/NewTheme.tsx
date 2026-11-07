import type { Theme } from "@overlay/theme/types";
import { useState } from "react";
import { Button } from "../controls";
import { defaultNewThemeName, PRESET_LOCKED_MESSAGE } from "./model";

const NAME_MAX_LENGTH = 40;

export interface NewThemeProps {
  /** The active theme; the new one starts as a copy of it. */
  base: Theme;
  /** True while a built-in theme is active (shows the explanation and a primary button). */
  preset: boolean;
  /** Creates the theme with this name and makes it active. */
  onCreate(name: string): void;
}

/** "New theme" button that asks for a name inline, then creates the theme. */
export function NewTheme({ base, preset, onCreate }: NewThemeProps) {
  const [name, setName] = useState<string | null>(null);
  const submit = (): void => {
    if (name === null || name.trim() === "") return;
    onCreate(name);
    setName(null);
  };
  return (
    <div className="ap-new">
      {preset && <p className="note">{PRESET_LOCKED_MESSAGE}</p>}
      {name === null ? (
        <Button
          variant={preset ? "primary" : "secondary"}
          onClick={() => setName(defaultNewThemeName(base))}
        >
          {preset ? "New theme from this…" : "New theme"}
        </Button>
      ) : (
        <div className="ap-new-form">
          <input
            type="text"
            aria-label="New theme name"
            autoFocus
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setName(null);
            }}
          />
          <Button variant="primary" disabled={name.trim() === ""} onClick={submit}>
            Create
          </Button>
          <Button onClick={() => setName(null)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
