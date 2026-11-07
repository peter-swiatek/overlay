import {
  forkTheme,
  MAX_THEME_CODE_LENGTH,
  sanitizeThemeName,
  THEME_TOKEN_KEYS,
} from "@overlay/theme";
import type { Theme, ThemeState, ThemeTokenKey } from "@overlay/theme/types";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { OverlayApi } from "../../../../shared/types";
import { Button, ColourInput } from "../../controls";
import {
  activeTheme,
  createThemeWriter,
  isPreset,
  PRESET_LOCKED_MESSAGE,
  type ThemeEdit,
  type ThemeWriter,
} from "../model";
import { AlphaSlider } from "./AlphaSlider";
import { contrastWarnings } from "./contrast";
import { createDebouncer, type Timers } from "./debounce";
import { ThemePreview } from "./Preview";
import "./editor.css";

export type EditorApi = Pick<
  OverlayApi["theme"],
  "save" | "setActive" | "remove" | "importCode" | "exportCode" | "importFile" | "exportFile"
> &
  Partial<Pick<OverlayApi["theme"], "getState">>;

export const SAVE_DEBOUNCE_MS = 400;

// useLayoutEffect warns during server rendering (used by the markup tests).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  backgroundTint: "Background tint",
  row: "Row",
  rowAlt: "Alternate row",
  header: "Header",
  accent: "Accent",
  text: "Text",
  textMuted: "Muted text",
  border: "Border",
  ownRow: "Own row",
};

export const LOCKED_LINE =
  "Locked colours (deltas, fastest lap, licences, flags, class colours) are never part of a theme.";

function mergeEdit(a: ThemeEdit, b: ThemeEdit): ThemeEdit {
  const merged: ThemeEdit = { ...a, ...b };
  if (a.tokens || b.tokens) merged.tokens = { ...a.tokens, ...b.tokens } as Theme["tokens"];
  return merged;
}

function applyEdit(base: Theme, edit: ThemeEdit | null): Theme {
  return edit ? { ...base, ...edit, tokens: { ...base.tokens, ...edit.tokens } } : base;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not save the theme";
}

export interface ThemeEditorPanelProps {
  state: ThemeState;
  api: EditorApi;
  onState(next: ThemeState): void;
  onClose(): void;
  /** The page's shared theme writer; without one the panel makes its own. */
  writer?: ThemeWriter;
  /** Set to a function that flushes the pending draft and resolves once it is saved. */
  settleRef?: MutableRefObject<(() => Promise<unknown>) | null>;
  /** Tests inject timers and a clipboard. */
  timers?: Timers;
  writeClipboard?(text: string): Promise<void>;
}

export function ThemeEditorPanel(props: ThemeEditorPanelProps) {
  const { state, api, onClose } = props;
  const active = activeTheme(state);
  const preset = isPreset(state, active.id);

  const [draftEdit, setDraftEdit] = useState<ThemeEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renameText, setRenameText] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [imported, setImported] = useState<Theme | null>(null);

  const draftRef = useRef<ThemeEdit | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onStateRef = useRef(props.onState);
  onStateRef.current = props.onState;
  const lastWrite = useRef<Promise<void>>(Promise.resolve());
  const writer = useMemo(() => props.writer ?? createThemeWriter(api), [api, props.writer]);
  /** The theme the draft was made on; the draft is only ever written there. */
  const draftTarget = useRef<string | null>(null);
  const inFlight = useRef(0);

  const accept = (next: ThemeState): void => {
    stateRef.current = next;
    onStateRef.current(next);
  };

  const runSave = (): void => {
    const edit = draftRef.current;
    if (!edit) return;
    const target = draftTarget.current ?? activeTheme(stateRef.current).id;
    draftTarget.current = target;
    inFlight.current += 1;
    // The whole draft is sent each time (merging is idempotent), so a failed save is retried
    // with the next commit.
    lastWrite.current = writer.write(stateRef.current, edit, { target }).then(
      (next) => {
        inFlight.current -= 1;
        if (draftRef.current === edit) {
          draftRef.current = null;
          draftTarget.current = null;
          setDraftEdit(null);
        }
        setError(null);
        accept(next);
      },
      (e: unknown) => {
        inFlight.current -= 1;
        setError(messageOf(e));
        // Resync, so the next attempt starts from what was really saved.
        void api.getState?.().then(accept, () => undefined);
      },
    );
  };

  const runSaveRef = useRef(runSave);
  runSaveRef.current = runSave;
  const debouncer = useRef<ReturnType<typeof createDebouncer> | null>(null);
  debouncer.current ??= createDebouncer(() => runSaveRef.current(), SAVE_DEBOUNCE_MS, props.timers);
  const deb = debouncer.current;

  useEffect(() => () => deb.flush(), [deb]);

  const commit = (edit: ThemeEdit, now = false): void => {
    if (isPreset(stateRef.current, activeTheme(stateRef.current).id)) return;
    if (draftRef.current === null) draftTarget.current = activeTheme(stateRef.current).id;
    draftRef.current = mergeEdit(draftRef.current ?? {}, edit);
    setDraftEdit(draftRef.current);
    if (now) {
      deb.cancel();
      runSave();
    } else deb.schedule();
  };

  const settle = async (): Promise<ThemeState> => {
    deb.flush();
    await lastWrite.current;
    return stateRef.current;
  };
  const settleRef = props.settleRef;
  if (settleRef) settleRef.current = settle;
  useEffect(
    () => () => {
      if (settleRef) settleRef.current = null;
    },
    [settleRef],
  );

  // Backstop: if the active theme changes under a draft that no write is carrying, the draft
  // is saved to the theme it was made on and does not touch the new one.
  useIsoLayoutEffect(() => {
    const target = draftTarget.current;
    if (!draftRef.current || target === null || inFlight.current > 0) return;
    if (target === active.id) return;
    deb.cancel();
    runSaveRef.current();
  }, [active.id, deb]);

  const guard = (fn: () => Promise<void>) => (): void => {
    setError(null);
    setNotice(null);
    fn().catch((e: unknown) => setError(messageOf(e)));
  };

  const close = (): void => {
    deb.flush();
    onClose();
  };

  const target = draftTarget.current;
  const draftHere = target !== null && target === active.id;
  const theme = applyEdit(active, draftHere ? draftEdit : null);
  const warnings = contrastWarnings(theme.tokens);

  const saveAsNew = guard(async () => {
    deb.cancel();
    await lastWrite.current;
    const base = applyEdit(activeTheme(stateRef.current), draftRef.current);
    const st = stateRef.current;
    const fork = forkTheme(base, [...st.presets, ...st.custom]);
    await api.save(fork);
    accept(await writer.select(fork.id));
    draftRef.current = null;
    draftTarget.current = null;
    setDraftEdit(null);
  });

  const duplicate = guard(async () => {
    const st = await settle();
    accept(await api.save(forkTheme(activeTheme(st), [...st.presets, ...st.custom])));
  });

  const remove = guard(async () => {
    deb.cancel();
    await lastWrite.current;
    const id = activeTheme(stateRef.current).id;
    draftRef.current = null;
    draftTarget.current = null;
    setDraftEdit(null);
    setConfirmDelete(false);
    accept(await api.remove(id));
  });

  const copyCode = guard(async () => {
    const st = await settle();
    const code = await api.exportCode(activeTheme(st).id);
    if (code === null) throw new Error("Could not make a share code");
    try {
      await (props.writeClipboard ?? ((t) => navigator.clipboard.writeText(t)))(code);
      setShownCode(null);
      setNotice("Copied");
    } catch {
      setShownCode(code);
    }
  });

  const exportFile = guard(async () => {
    const st = await settle();
    if (await api.exportFile(activeTheme(st).id)) setNotice("Exported");
  });

  const accepted = (result: Awaited<ReturnType<EditorApi["importCode"]>> | null): void => {
    if (!result) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    accept(result.state);
    setImported(result.theme);
    setPasted("");
  };

  const importCode = guard(async () => {
    setImported(null);
    const code = pasted.replace(/\s+/g, "");
    if (code.length > MAX_THEME_CODE_LENGTH) {
      setError("This code is too long");
      return;
    }
    accepted(await api.importCode(code));
  });

  const importFile = guard(async () => {
    setImported(null);
    accepted(await api.importFile());
  });

  const useImported = guard(async () => {
    if (!imported) return;
    accept(await writer.select(imported.id));
    setImported(null);
  });

  const commitName = (): void => {
    if (renameText === null) return;
    const name = sanitizeThemeName(renameText);
    setRenameText(null);
    if (name !== theme.name) commit({ name }, true);
  };

  return (
    <div className="ed">
      <div className="ed-head">
        <strong>Edit colours</strong>
        <Button onClick={close}>Close</Button>
      </div>
      {preset && <p className="note">{PRESET_LOCKED_MESSAGE}</p>}
      {error && (
        <p className="ed-error" role="alert">
          {error}
        </p>
      )}
      <div className="ed-main">
        <div className="ed-tokens">
          {THEME_TOKEN_KEYS.map((key) => (
            <div className="ed-token" key={key} data-token={key}>
              <span className="ed-label">{TOKEN_LABELS[key]}</span>
              <ColourInput
                allowAlpha
                label={TOKEN_LABELS[key]}
                disabled={preset}
                value={theme.tokens[key]}
                onChange={(next) =>
                  commit({ tokens: { [key]: next.toLowerCase() } as Theme["tokens"] })
                }
              />
              <AlphaSlider
                label={`${TOKEN_LABELS[key]} alpha`}
                disabled={preset}
                value={theme.tokens[key]}
                onCommit={(next) => commit({ tokens: { [key]: next } as Theme["tokens"] })}
              />
              {warnings
                .filter((w) => w.token === key)
                .map((w) => (
                  <p key={w.against} className="ed-warn">
                    {w.message}
                  </p>
                ))}
            </div>
          ))}
          <p className="muted">{LOCKED_LINE}</p>
        </div>
        <ThemePreview theme={theme} />
      </div>

      <div className="ed-manage">
        <label className="ed-rename">
          <span>Name</span>
          <input
            type="text"
            aria-label="Theme name"
            disabled={preset}
            maxLength={40}
            value={renameText ?? theme.name}
            onChange={(e) => setRenameText(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenameText(null);
            }}
          />
        </label>
        <div className="ed-buttons">
          <Button disabled={preset} onClick={saveAsNew}>
            Save as new
          </Button>
          <Button onClick={duplicate}>Duplicate</Button>
          <Button variant="danger" disabled={preset} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
          <Button onClick={copyCode}>Copy share code</Button>
          <Button onClick={exportFile}>Export file</Button>
          <Button onClick={importFile}>Import file</Button>
        </div>
        {confirmDelete && !preset && (
          <p className="ed-confirm">
            Delete {theme.name}? This cannot be undone.{" "}
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>{" "}
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </p>
        )}
        {notice && <p className="note">{notice}</p>}
        {shownCode !== null && (
          <textarea
            className="ed-code"
            aria-label="Share code"
            readOnly
            autoFocus
            rows={3}
            value={shownCode}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <div className="ed-paste">
          <textarea
            className="ed-code"
            aria-label="Paste a share code"
            placeholder="Paste a share code here"
            rows={3}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <Button onClick={importCode} disabled={pasted.trim() === ""}>
            Import
          </Button>
        </div>
        {imported && (
          <p className="note">
            Imported {imported.name} <Button onClick={useImported}>Use it</Button>
          </p>
        )}
      </div>
    </div>
  );
}
