import { useId, useState, type ReactNode } from "react";

// Form controls shared by every settings page. The props are the contract (C11).

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ctl-section">
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      <div className="ctl-rows">{children}</div>
    </section>
  );
}

export function Row({
  label,
  help,
  disabled,
  badge,
  children,
}: {
  label: string;
  help?: string;
  disabled?: boolean;
  badge?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className="ctl-row"
      role="group"
      aria-labelledby={id}
      aria-disabled={disabled || undefined}
    >
      <div className="ctl-row-text">
        <span className="ctl-label" id={id}>
          {label}
          {badge && <em className="ctl-badge">{badge}</em>}
        </span>
        {help && <small className="muted">{help}</small>}
      </div>
      <div className="ctl-row-control">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  /** Accessible name when the toggle is not inside a labelled Row. */
  label?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="ctl-toggle"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(next: T): void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <select
      className="ctl-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const match = options.find((o) => o.value === e.target.value);
        if (match) onChange(match.value);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(next: T): void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="ctl-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface NumberControlProps {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange(next: number): void;
  disabled?: boolean;
}

/** Clamps to [min, max] and snaps to the step grid that starts at min. */
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Trim float noise from steps such as 0.1.
  return Math.min(max, Math.max(min, Number(snapped.toFixed(10))));
}

/** The number typed so far, or null when it is empty or not a finite number. */
export function parseNumberDraft(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** While typing, only values already inside the range are committed; the rest wait for blur. */
export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export function NumberStepper({
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: NumberControlProps) {
  // null = show the committed value; a string = the user is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (n: number): void => {
    const next = clampToStep(n, min, max, step);
    if (next !== value) onChange(next);
  };
  const bump = (direction: 1 | -1): void => {
    setDraft(null);
    commit(value + direction * step);
  };
  return (
    <span className="ctl-number">
      <button
        type="button"
        aria-label="Decrease"
        disabled={disabled || value <= min}
        onClick={() => bump(-1)}
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNumberDraft(e.target.value);
          if (n !== null && inRange(n, min, max)) commit(n);
        }}
        onBlur={() => {
          const n = draft === null ? null : parseNumberDraft(draft);
          if (n !== null) commit(n);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <button
        type="button"
        aria-label="Increase"
        disabled={disabled || value >= max}
        onClick={() => bump(1)}
      >
        +
      </button>
      {unit && <span className="ctl-unit">{unit}</span>}
    </span>
  );
}

export function Slider({ value, min, max, step, unit, onChange, disabled }: NumberControlProps) {
  return (
    <span className="ctl-slider">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>
        {value}
        {unit ? ` ${unit}` : ""}
      </output>
    </span>
  );
}

const HEX_RGB = /^#[0-9a-f]{6}$/i;
const HEX_RGBA = /^#[0-9a-f]{8}$/i;

/** True for "#rrggbb", and for "#rrggbbaa" when alpha is allowed. */
export function isColourText(text: string, allowAlpha: boolean): boolean {
  return HEX_RGB.test(text) || (allowAlpha && HEX_RGBA.test(text));
}

export function ColourInput({
  value,
  onChange,
  allowAlpha,
  onReset,
  resetLabel,
}: {
  value: string;
  onChange(next: string): void;
  allowAlpha?: boolean;
  onReset?: () => void;
  resetLabel?: string;
}) {
  const alpha = allowAlpha ?? false;
  const rgb = value.slice(0, 7);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="ctl-colour">
      <input
        type="text"
        aria-label="Colour (hex)"
        value={draft ?? value}
        maxLength={alpha ? 9 : 7}
        spellCheck={false}
        onChange={(e) => {
          // Partial input stays in the draft; only a complete valid hex is committed.
          const text = e.target.value.trim().toLowerCase();
          setDraft(text);
          if (isColourText(text, alpha) && text !== value) onChange(text);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <input
        type="color"
        aria-label="Colour picker"
        value={HEX_RGB.test(rgb) ? rgb : "#000000"}
        onChange={(e) => {
          setDraft(null);
          // The native picker has no alpha channel, so keep the existing alpha suffix.
          const suffix = alpha && HEX_RGBA.test(value) ? value.slice(7) : "";
          onChange(e.target.value.toLowerCase() + suffix);
        }}
      />
      {onReset && (
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            onReset();
          }}
        >
          {resetLabel ?? "Reset"}
        </button>
      )}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ctl-button"
      data-variant={variant}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
