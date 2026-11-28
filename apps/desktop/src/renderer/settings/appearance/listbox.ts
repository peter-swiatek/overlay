// Keyboard model of a select-only combobox (WAI-ARIA APG): focus stays on the button and
// `active` is the highlighted option. Kept free of React and the DOM so it is easy to test.

export interface ListboxState {
  open: boolean;
  /** Index of the highlighted option. */
  active: number;
}

export interface ListboxStep {
  state: ListboxState;
  /** The option to choose, when the key chose one. */
  pick?: number;
  /** True when the key was used, so the browser default (scrolling, submitting) is cancelled. */
  handled: boolean;
}

export interface ListboxKey {
  key: string;
  altKey?: boolean;
}

/**
 * What a key press does. `selected` is the index of the current value and `labels` are the
 * option names. `typed` is the type-ahead text so far including this key, or "" when the key is
 * not part of a type-ahead; while it is set the key only moves the highlight (and opens the list).
 */
export function listboxKey(
  state: ListboxState,
  event: ListboxKey,
  selected: number,
  labels: readonly string[],
  typed = "",
): ListboxStep {
  const last = labels.length - 1;
  const at = (active: number, open = true): ListboxStep => ({
    state: { open, active: Math.min(last, Math.max(0, active)) },
    handled: true,
  });
  const { key } = event;

  if (typed !== "") {
    const from = state.open ? state.active : selected;
    return at(typeAhead(labels, typed, from) ?? from);
  }

  if (!state.open) {
    switch (key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        return at(selected);
      case "Home":
        return at(0);
      case "End":
        return at(last);
    }
    return { state, handled: false };
  }

  switch (key) {
    case "ArrowDown":
      if (event.altKey) return at(state.active);
      return at(state.active + 1);
    case "ArrowUp":
      // Alt+Up chooses the highlighted option and closes, like a native select.
      if (event.altKey) return { ...at(state.active, false), pick: state.active };
      return at(state.active - 1);
    case "Home":
    case "PageUp":
      return at(0);
    case "End":
    case "PageDown":
      return at(last);
    case "Enter":
    case " ":
      return { ...at(state.active, false), pick: state.active };
    case "Escape":
      return at(selected, false);
    case "Tab":
      // Closes without choosing; focus moves on as usual.
      return { state: { open: false, active: selected }, handled: false };
  }
  return { state, handled: false };
}

/**
 * The option whose label starts with `typed` (case-insensitive), searching from `from`. A single
 * letter starts after `from`, so pressing the same letter again cycles through its matches.
 */
export function typeAhead(labels: readonly string[], typed: string, from: number): number | null {
  const query = typed.toLowerCase();
  if (query === "") return null;
  const n = labels.length;
  const start = query.length === 1 ? from + 1 : from;
  for (let i = 0; i < n; i++) {
    const index = (((start + i) % n) + n) % n;
    if (labels[index]!.toLowerCase().startsWith(query)) return index;
  }
  return null;
}
