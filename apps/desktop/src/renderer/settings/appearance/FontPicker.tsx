import { THEME_FONTS, fontFamilyCss } from "@overlay/theme";
import type { ThemeFont, ThemeWeight } from "@overlay/theme/types";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { FONT_LABELS, FONT_SAMPLE } from "./fonts";
import { listboxKey, type ListboxState } from "./listbox";
import "./appearance.css";

const LABELS = THEME_FONTS.map((f) => FONT_LABELS[f]);
/** Type-ahead text is forgotten after this pause. */
const TYPE_AHEAD_MS = 600;

export interface FontPickerViewProps {
  id: string;
  label: string;
  value: ThemeFont;
  weight: ThemeWeight;
  open: boolean;
  /** Index into THEME_FONTS of the highlighted option. */
  active: number;
  onToggle(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
  onBlur(): void;
  onHover(index: number): void;
  onPick(font: ThemeFont): void;
}

/**
 * A select-only combobox: a button that shows the current font in that font, and a listbox
 * where every font name and sample is drawn in its own font. A native select is not used
 * because its options cannot reliably show custom fonts on every platform.
 */
export function FontPickerView(props: FontPickerViewProps) {
  const { id, value, open, active } = props;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  return (
    <div className="ap-font" data-open={open || undefined}>
      <button
        type="button"
        role="combobox"
        className="ctl-select ap-font-button"
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        style={{ fontFamily: fontFamilyCss(value) }}
        onClick={props.onToggle}
        onKeyDown={props.onKeyDown}
        onBlur={props.onBlur}
      >
        <span className="ap-font-value">{FONT_LABELS[value]}</span>
        <span className="ap-font-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label={props.label}
        className="ap-font-list"
        hidden={!open}
        // Keeps focus on the button, so the list does not close before a click lands.
        onMouseDown={(e) => e.preventDefault()}
      >
        {THEME_FONTS.map((font, i) => (
          <li
            key={font}
            id={optionId(i)}
            role="option"
            aria-selected={font === value}
            data-active={i === active || undefined}
            data-font={font}
            style={{ fontFamily: fontFamilyCss(font) }}
            onMouseMove={() => {
              if (i !== active) props.onHover(i);
            }}
            onClick={() => props.onPick(font)}
          >
            <span className="ap-font-check" aria-hidden="true">
              {font === value ? "✓" : ""}
            </span>
            <span className="ap-font-name">{FONT_LABELS[font]}</span>
            <span
              className="ap-font-sample"
              aria-hidden="true"
              style={{ fontWeight: props.weight }}
            >
              {FONT_SAMPLE}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FontPicker({
  value,
  weight,
  label,
  onChange,
  defaultOpen = false,
}: {
  value: ThemeFont;
  weight: ThemeWeight;
  label: string;
  onChange(font: ThemeFont): void;
  /** Starts with the list open; for tests and screenshots. */
  defaultOpen?: boolean;
}) {
  const id = useId();
  const selected = Math.max(0, THEME_FONTS.indexOf(value));
  const [state, setState] = useState<ListboxState>({ open: defaultOpen, active: selected });
  const typed = useRef({ text: "", at: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => setState({ open: false, active: selected });
  const pick = (font: ThemeFont) => {
    setState({ open: false, active: THEME_FONTS.indexOf(font) });
    if (font !== value) onChange(font);
  };

  // Closes on a press anywhere outside the picker.
  useEffect(() => {
    if (!state.open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setState({ open: false, active: selected });
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [state.open, selected]);

  // Keeps the highlighted option in view.
  useEffect(() => {
    if (!state.open) return;
    const el = rootRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [state.open, state.active]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey) return;
    const now = Date.now();
    const typing = now - typed.current.at < TYPE_AHEAD_MS;
    // A printable key starts or extends the type-ahead; a space only extends one ("DM S").
    const text =
      e.key.length === 1 && (e.key !== " " || typing)
        ? (typing ? typed.current.text : "") + e.key
        : "";
    typed.current = text ? { text, at: now } : { text: "", at: 0 };
    const step = listboxKey(state, { key: e.key, altKey: e.altKey }, selected, LABELS, text);
    if (step.handled) e.preventDefault();
    setState(step.state);
    if (step.pick !== undefined) {
      const font = THEME_FONTS[step.pick];
      if (font !== undefined && font !== value) onChange(font);
    }
  };

  return (
    <div ref={rootRef} className="ap-font-root">
      <FontPickerView
        id={id}
        label={label}
        value={value}
        weight={weight}
        open={state.open}
        active={state.open ? state.active : selected}
        onToggle={() => (state.open ? close() : setState({ open: true, active: selected }))}
        onKeyDown={onKeyDown}
        onBlur={close}
        onHover={(active) => setState({ open: true, active })}
        onPick={pick}
      />
    </div>
  );
}
