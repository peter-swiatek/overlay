import type { ReactNode } from "react";

// Plain, unstyled controls. The settings shell restyles them; the props are the shared contract.

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
    <section>
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      {children}
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
  return (
    <div className="option" aria-disabled={disabled || undefined}>
      <span>{label}</span>
      {badge && <em>{badge}</em>}
      {children}
      {help && <small className="muted">{help}</small>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
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
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(next: T): void;
  disabled?: boolean;
}) {
  return (
    <select
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
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(next: T): void;
}) {
  return (
    <div role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
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

export function NumberStepper({
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: NumberControlProps) {
  return (
    <span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)));
          }
        }}
      />
      {unit && <span> {unit}</span>}
    </span>
  );
}

export function Slider({ value, min, max, step, unit, onChange, disabled }: NumberControlProps) {
  return (
    <span>
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
  return (
    <span>
      <input
        type="text"
        value={value}
        maxLength={alpha ? 9 : 7}
        spellCheck={false}
        onChange={(e) => {
          const text = e.target.value.trim().toLowerCase();
          if (isColourText(text, alpha)) onChange(text);
        }}
      />
      <input
        type="color"
        value={HEX_RGB.test(rgb) ? rgb : "#000000"}
        onChange={(e) => {
          // The native picker has no alpha channel, so keep the existing alpha suffix.
          const suffix = alpha && HEX_RGBA.test(value) ? value.slice(7) : "";
          onChange(e.target.value.toLowerCase() + suffix);
        }}
      />
      {onReset && (
        <button type="button" onClick={onReset}>
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
    <button type="button" data-variant={variant} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
