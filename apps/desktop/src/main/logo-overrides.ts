import { mkdirSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import { IPC } from "../shared/types";
import type { IpcContext } from "./ipc/context";

/**
 * The user's own manufacturer logos: <userData>/logos/<make-id>.svg|png (Windows:
 * %APPDATA%\Overlay\logos). They replace the bundled logos in the Leaderboard's Make column. Main
 * reads them and hands them to the windows as data URLs, so overlay pages never touch the disk.
 */

export const LOGOS_DIR = "logos";

/** Make ids as sim-core names them: lower case, words joined by "-". */
const MAKE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Larger files are skipped (a logo is a few KB; this keeps IPC messages small). */
export const MAX_LOGO_BYTES = 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface LogoFs {
  readdir(dir: string): string[];
  size(path: string): number;
  read(path: string): Buffer;
}

const nodeFs: LogoFs = {
  readdir: (dir) => readdirSync(dir),
  size: (path) => statSync(path).size,
  read: (path) => readFileSync(path),
};

function isPng(bytes: Buffer): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function isSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 4096).toString("utf8");
  return /<svg[\s>]/i.test(head);
}

/**
 * Make id -> data URL for every usable file in `dir`: `<id>.svg` or `<id>.png` (lower-case id,
 * either case of extension), SVG winning over PNG, at most MAX_LOGO_BYTES, and really an SVG or
 * a PNG. A missing folder or unreadable file is skipped.
 */
export function readLogoOverrides(dir: string, fs: LogoFs = nodeFs): Record<string, string> {
  let names: string[];
  try {
    names = fs.readdir(dir);
  } catch {
    return {};
  }
  const found = new Map<string, { svg?: string; png?: string }>();
  for (const name of names) {
    const match = /^(.+)\.(svg|png)$/i.exec(name);
    if (match === null) continue;
    const id = match[1] as string;
    if (!MAKE_ID.test(id)) continue;
    const ext = (match[2] as string).toLowerCase() as "svg" | "png";
    found.set(id, { ...found.get(id), [ext]: name });
  }
  const out: Record<string, string> = {};
  for (const [id, files] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [ext, name] of [
      ["svg", files.svg],
      ["png", files.png],
    ] as const) {
      if (name === undefined) continue;
      try {
        const path = join(dir, name);
        if (fs.size(path) > MAX_LOGO_BYTES) continue;
        const bytes = fs.read(path);
        if (ext === "svg" ? !isSvg(bytes) : !isPng(bytes)) continue;
        const mime = ext === "svg" ? "image/svg+xml" : "image/png";
        out[id] = `data:${mime};base64,${bytes.toString("base64")}`;
        break;
      } catch {
        // Unreadable: try the other file, else no override.
      }
    }
  }
  return out;
}

function sameLogos(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k]);
}

/** Holds the current overrides, re-reads them on request and when the folder changes. */
export class LogoOverrides {
  private current: Record<string, string> = {};
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<(logos: Record<string, string>) => void>();

  constructor(
    readonly dir: string,
    private readonly fs: LogoFs = nodeFs,
  ) {}

  get(): Record<string, string> {
    return this.current;
  }

  /** Re-reads the folder; tells the listeners when something changed. Returns whether it did. */
  reload(): boolean {
    const next = readLogoOverrides(this.dir, this.fs);
    if (sameLogos(next, this.current)) return false;
    this.current = next;
    for (const listener of this.listeners) listener(next);
    return true;
  }

  onChange(listener: (logos: Record<string, string>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Creates the folder (so the user can find it) and re-reads it shortly after each change. */
  watch(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      this.watcher = watch(this.dir, () => {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reload(), 300);
      });
      this.watcher.on("error", () => this.close());
    } catch (error) {
      console.error("Could not watch the logos folder", error);
    }
  }

  close(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}

/** Whether an overlay's settings show the Make column (re-read the folder when it turns on). */
export function showsMakeColumn(settings: {
  common: { fields: readonly { id: string; visible: boolean }[] };
}): boolean {
  return settings.common.fields.some((f) => f.id === "make" && f.visible);
}

/** `logos:get` for the overlay and main windows; `logos:changed` goes to every window. */
export function registerLogoIpc(ctx: IpcContext, logos: LogoOverrides): void {
  ipcMain.handle(IPC.logosGet, (event) => {
    if (!ctx.isSettingsSender(event.sender) && !ctx.isOverlaySender(event.sender)) {
      ctx.deny(IPC.logosGet);
    }
    return logos.get();
  });
  logos.onChange((next) => ctx.broadcast(IPC.logosChanged, next));
}
