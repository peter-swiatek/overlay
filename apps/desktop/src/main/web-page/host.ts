import { WebContentsView, session, type BrowserWindow, type WebContents } from "electron";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import { webviewOptions } from "@overlay/overlays/webview";
import {
  LOAD_RETRY_MS,
  buildWebPagePreferences,
  guardWebPageContents,
  hardenWebPageSession,
  pageBackground,
  pageCss,
  pageZoomFactor,
  parsePageRect,
  partitionFor,
  shouldRetryLoad,
} from "./guards";

/** Pages this host created; the app-wide "never navigate" rule leaves them to their own guards. */
const pageContents = new WeakSet<WebContents>();
const hardenedPartitions = new Set<string>();

export function isWebPageContents(contents: WebContents): boolean {
  return pageContents.has(contents);
}

interface Entry {
  win: BrowserWindow;
  view: WebContentsView;
  /** The address loaded (or loading) now. */
  url: string | null;
  /** Forced rules and the user's CSS, as inserted into the current document. */
  forcedCss: string;
  customCss: string;
  cssKeys: string[];
  /** CSS changes run one after the other (each awaits Chromium). */
  cssQueue: Promise<void>;
  refreshMs: number | null;
  refreshTimer: NodeJS.Timeout | undefined;
  retryTimer: NodeJS.Timeout | undefined;
  zoom: number;
}

export interface WebPageHostDeps {
  settingsOf(id: string): OverlayInstanceSettings | undefined;
  isEditMode(): boolean;
}

/**
 * Embeds the Webview overlay's pages: one WebContentsView per overlay instance, attached to its
 * window and laid over the page area the window reports. The address always comes from the stored
 * settings (validated again here), never from the overlay window.
 */
export class WebPageHost {
  private readonly entries = new Map<string, Entry>();
  private editing: boolean;

  constructor(private readonly deps: WebPageHostDeps) {
    this.editing = deps.isEditMode();
  }

  /** The overlay window of instance `id` reported its page area (null: hide the page). */
  setRect(id: string, win: BrowserWindow, payload: unknown): void {
    if (win.isDestroyed()) return;
    const settings = this.deps.settingsOf(id);
    const url = settings ? webviewOptions(settings).url : null;
    if (settings === undefined || url === null) {
      this.dispose(id);
      return;
    }
    const content = win.getContentBounds();
    const rect = parsePageRect(payload, content);
    let entry = this.entries.get(id);
    if (rect === null) {
      entry?.view.setVisible(false);
      return;
    }
    if (entry && entry.win !== win) {
      this.dispose(id);
      entry = undefined;
    }
    entry ??= this.create(id, win, settings);
    entry.view.setBounds(rect);
    entry.view.setVisible(true);
  }

  /** Stored settings of `id` changed. */
  onSettings(id: string, settings: OverlayInstanceSettings): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (webviewOptions(settings).url === null) this.dispose(id);
    else this.apply(entry, settings);
  }

  /** Overlays were locked or unlocked: the page takes clicks only when allowed to. */
  setEditMode(editing: boolean): void {
    if (editing === this.editing) return;
    this.editing = editing;
    for (const [id, entry] of this.entries) {
      const settings = this.deps.settingsOf(id);
      if (settings) this.apply(entry, settings);
    }
  }

  /** An added instance was removed: drop its page and everything it stored. */
  remove(id: string): void {
    this.dispose(id);
    void session
      .fromPartition(partitionFor(id))
      .clearStorageData()
      .catch(() => undefined);
  }

  disposeAll(): void {
    for (const id of [...this.entries.keys()]) this.dispose(id);
  }

  private create(id: string, win: BrowserWindow, settings: OverlayInstanceSettings): Entry {
    const partition = partitionFor(id);
    if (!hardenedPartitions.has(partition)) {
      hardenWebPageSession(session.fromPartition(partition));
      hardenedPartitions.add(partition);
    }
    const view = new WebContentsView({ webPreferences: buildWebPagePreferences(partition) });
    const contents = view.webContents;
    pageContents.add(contents);
    guardWebPageContents(contents);
    contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
    const entry: Entry = {
      win,
      view,
      url: null,
      forcedCss: "",
      customCss: "",
      cssKeys: [],
      cssQueue: Promise.resolve(),
      refreshMs: null,
      refreshTimer: undefined,
      retryTimer: undefined,
      zoom: 1,
    };
    // Inserted CSS and zoom belong to a document: put them back on every new one.
    contents.on("dom-ready", () => {
      this.queueCss(entry, true);
      contents.setZoomFactor(entry.zoom);
    });
    contents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
      if (!shouldRetryLoad(errorCode, isMainFrame)) return;
      clearTimeout(entry.retryTimer);
      entry.retryTimer = setTimeout(() => {
        if (!contents.isDestroyed() && entry.url !== null) void this.load(entry, entry.url);
      }, LOAD_RETRY_MS);
    });
    contents.on("render-process-gone", () => {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = setTimeout(() => {
        if (!contents.isDestroyed()) contents.reload();
      }, LOAD_RETRY_MS);
    });
    view.setVisible(false);
    win.contentView.addChildView(view);
    win.once("closed", () => {
      if (this.entries.get(id)?.win === win) this.dispose(id);
    });
    this.entries.set(id, entry);
    this.apply(entry, settings);
    return entry;
  }

  private apply(entry: Entry, settings: OverlayInstanceSettings): void {
    const o = webviewOptions(settings);
    const contents = entry.view.webContents;
    if (contents.isDestroyed()) return;
    entry.view.setBackgroundColor(pageBackground(o.transparent));
    entry.zoom = pageZoomFactor(o.zoomPct, settings.common.scalePct);
    contents.setZoomFactor(entry.zoom);
    const forced = pageCss({
      transparent: o.transparent,
      hideScrollbars: o.hideScrollbars,
      opacityPct: settings.common.opacityPct,
      blockInput: this.editing && !o.interactive,
    });
    if (forced !== entry.forcedCss || o.customCss !== entry.customCss) {
      entry.forcedCss = forced;
      entry.customCss = o.customCss;
      this.queueCss(entry, false);
    }
    if (o.refreshMs !== entry.refreshMs) {
      clearInterval(entry.refreshTimer);
      entry.refreshTimer = undefined;
      entry.refreshMs = o.refreshMs;
      if (o.refreshMs !== null) {
        entry.refreshTimer = setInterval(() => {
          if (!contents.isDestroyed() && !contents.isLoading()) contents.reload();
        }, o.refreshMs);
      }
    }
    if (o.url !== null && o.url !== entry.url) void this.load(entry, o.url);
  }

  private async load(entry: Entry, url: string): Promise<void> {
    entry.url = url;
    clearTimeout(entry.retryTimer);
    try {
      await entry.view.webContents.loadURL(url);
    } catch {
      // did-fail-load schedules the retry.
    }
  }

  /** Replaces the CSS inserted into the document; a new document has none of the old keys. */
  private queueCss(entry: Entry, newDocument: boolean): void {
    entry.cssQueue = entry.cssQueue.then(() => this.insertCss(entry, newDocument));
  }

  private async insertCss(entry: Entry, newDocument: boolean): Promise<void> {
    const contents = entry.view.webContents;
    if (contents.isDestroyed()) return;
    const old = newDocument ? [] : entry.cssKeys;
    entry.cssKeys = [];
    try {
      for (const key of old) await contents.removeInsertedCSS(key);
      if (entry.forcedCss !== "") {
        entry.cssKeys.push(await contents.insertCSS(entry.forcedCss, { cssOrigin: "user" }));
      }
      if (entry.customCss.trim() !== "") {
        entry.cssKeys.push(await contents.insertCSS(entry.customCss, { cssOrigin: "author" }));
      }
    } catch {
      // The document went away mid-way; dom-ready inserts again for the next one.
    }
  }

  private dispose(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    clearInterval(entry.refreshTimer);
    clearTimeout(entry.retryTimer);
    if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(entry.view);
    const contents = entry.view.webContents;
    if (!contents.isDestroyed()) contents.close();
  }
}
