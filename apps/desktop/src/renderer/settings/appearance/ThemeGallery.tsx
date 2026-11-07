import { formatDriverName, formatLapTime, LicencePill } from "@overlay/ui";
import type { Theme, ThemeState } from "@overlay/theme/types";
import { ThemeScope } from "./ThemeScope";
import "./appearance.css";

const SWATCHES = [
  ["backgroundTint", "--ov-bg"],
  ["row", "--ov-row"],
  ["accent", "--ov-accent"],
  ["ownRow", "--ov-own-row"],
] as const;

function ThemeCard({
  theme,
  active,
  custom,
  onSelect,
}: {
  theme: Theme;
  active: boolean;
  custom: boolean;
  onSelect(id: string): void;
}) {
  return (
    <ThemeScope theme={theme} className="ap-card-scope">
      <button
        type="button"
        className="ap-card"
        aria-pressed={active}
        onClick={() => onSelect(theme.id)}
      >
        <span className="ap-card-head">
          <span className="ap-card-name">{theme.name}</span>
          {custom && <span className="ap-tag">Custom</span>}
          {active && <span className="ap-active">Active</span>}
        </span>
        <span className="ap-swatches">
          {SWATCHES.map(([key, variable]) => (
            <span key={key} className="ap-swatch" data-token={key}>
              <span style={{ background: `var(${variable})` }} />
            </span>
          ))}
        </span>
        <span className="ap-sample">
          <span className="ap-sample-pos">3</span>
          <LicencePill licence="A 3.41" />
          <span className="ap-sample-name">{formatDriverName("Max Example", "full")}</span>
          <span className="ap-sample-time">{formatLapTime(102.318)}</span>
        </span>
      </button>
    </ThemeScope>
  );
}

/** Presets first, then custom themes in stored order. */
export function ThemeGallery({
  state,
  onSelect,
}: {
  state: ThemeState;
  onSelect(id: string): void;
}) {
  return (
    <div className="ap-gallery">
      {state.presets.map((t) => (
        <ThemeCard
          key={t.id}
          theme={t}
          active={t.id === state.activeId}
          custom={false}
          onSelect={onSelect}
        />
      ))}
      {state.custom.map((t) => (
        <ThemeCard
          key={t.id}
          theme={t}
          active={t.id === state.activeId}
          custom
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
