/**
 * Security and layout rules for the web pages the Webview overlay embeds. Pure functions plus
 * installers that only need the Electron objects' methods, so tests can drive them with fakes.
 *
 * The page runs in its own WebContentsView owned by main: no preload, no Node, sandboxed and
 * context-isolated, in a session of its own, so it never reaches the app's IPC or files.
 */
import type { Session, WebContents, WebPreferences } from "electron";
import type { PageRect } from "@overlay/overlays/contract";
import { parseWebPageUrl } from "@overlay/overlays/web-url";

/** Session partitions of embedded pages start with this; one per overlay instance. */
export const WEB_PAGE_PARTITION_PREFIX = "persist:webview-";

/**
 * The session partition of an instance ("webview" -> "persist:webview-1", "webview:3" ->
 * "persist:webview-3"): each instance keeps its own cookies, storage and zoom, apart from the app.
 */
export function partitionFor(instanceId: string): string {
  const n = /:(\d+)$/.exec(instanceId)?.[1] ?? "1";
  return `${WEB_PAGE_PARTITION_PREFIX}${n}`;
}

/** WebPreferences of an embedded page. No `preload` key at all: the page gets no bridge. */
export function buildWebPagePreferences(partition: string): WebPreferences {
  return {
    partition,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    // alert(), confirm() and prompt() would block the page with nobody able to answer them.
    disableDialogs: true,
    autoplayPolicy: "document-user-activation-required",
    // Keeps animating and refreshing while the overlay window is not focused (it never is).
    backgroundThrottling: false,
  };
}

/** Top-level navigations and redirects may only go to http(s) pages. */
export function isAllowedNavigation(url: string): boolean {
  return parseWebPageUrl(url) !== null;
}

const REQUEST_SCHEMES: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "ws:",
  "wss:",
  "data:",
  "blob:",
]);

/** Requests a page may make (its own resources): web schemes only, never file: and the like. */
export function isAllowedRequest(url: string): boolean {
  try {
    return REQUEST_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Permissions an embedded page may have: none (camera, microphone, location, notifications...). */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set();

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** How a page asking for a new window (window.open, target=_blank) is answered. */
export const WINDOW_OPEN_DENIED = { action: "deny" } as const;

export type GuardedSession = Pick<
  Session,
  | "setPermissionRequestHandler"
  | "setPermissionCheckHandler"
  | "setDevicePermissionHandler"
  | "setDisplayMediaRequestHandler"
  | "setBluetoothPairingHandler"
  | "setSpellCheckerEnabled"
  | "on"
  | "webRequest"
>;

/** Locks down an embedded page's session. Call once per session, before any page loads in it. */
export function hardenWebPageSession(ses: GuardedSession): void {
  ses.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(isPermissionAllowed(permission)),
  );
  ses.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback(null));
  ses.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }));
  ses.setSpellCheckerEnabled(false);
  ses.on("will-download", (event) => event.preventDefault());
  ses.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault();
    callback(null);
  });
  ses.on("select-serial-port", (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback("");
  });
  ses.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
  });
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !isAllowedRequest(details.url) }),
  );
}

export type GuardedContents = Pick<WebContents, "setWindowOpenHandler" | "on">;

/** No popups, no navigation away from http(s), no nested webviews, no device pickers. */
export function guardWebPageContents(contents: GuardedContents): void {
  contents.setWindowOpenHandler(() => WINDOW_OPEN_DENIED);
  contents.on("will-navigate", (event) => {
    if (!isAllowedNavigation(event.url)) event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame && !isAllowedNavigation(event.url)) event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame && !isAllowedNavigation(event.url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("select-bluetooth-device", (event, _devices, callback) => {
    event.preventDefault();
    callback("");
  });
}

export interface PageCssInput {
  transparent: boolean;
  hideScrollbars: boolean;
  /** The overlay's Opacity setting: a native view does not take the window's CSS opacity. */
  opacityPct: number;
  /** True while overlays are unlocked and the page may not take clicks: the overlay drags instead. */
  blockInput: boolean;
}

/**
 * Style rules forced on the page (inserted as a user style sheet, so `!important` here wins over
 * the page's own). Empty when nothing is forced.
 */
export function pageCss(input: PageCssInput): string {
  const rules: string[] = [];
  if (input.transparent) {
    rules.push("html, body { background: transparent !important; }");
  }
  if (input.hideScrollbars) {
    rules.push("html, body, * { scrollbar-width: none !important; }");
    rules.push("::-webkit-scrollbar { display: none !important; width: 0 !important; }");
  }
  const opacity = Math.min(100, Math.max(0, input.opacityPct));
  if (opacity < 100) rules.push(`html { opacity: ${opacity / 100} !important; }`);
  if (input.blockInput) {
    rules.push("html { pointer-events: none !important; user-select: none !important; }");
    // A cover the window manager can drag by, where draggable regions reach embedded views.
    rules.push(
      'html::after { content: ""; position: fixed; inset: 0; z-index: 2147483647; ' +
        "-webkit-app-region: drag; pointer-events: none; }",
    );
  }
  return rules.join("\n");
}

/** Page zoom: the Webview's own zoom on top of the overlay's scale, kept within Chromium's range. */
export function pageZoomFactor(zoomPct: number, scalePct: number): number {
  const factor = (zoomPct / 100) * (scalePct / 100);
  if (!Number.isFinite(factor)) return 1;
  return Math.min(5, Math.max(0.25, Number(factor.toFixed(4))));
}

/** The page view's backdrop: see-through, or the white a browser shows under a page. */
export function pageBackground(transparent: boolean): string {
  return transparent ? "#00000000" : "#ffffffff";
}

/**
 * The page area an overlay window reported, as whole px clamped inside its content `bounds`;
 * null for anything malformed or empty (which hides the page).
 */
export function parsePageRect(
  payload: unknown,
  bounds: { width: number; height: number },
): PageRect | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const nums = [p.x, p.y, p.width, p.height];
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [x, y, width, height] = nums.map((v) => Math.round(v as number)) as [
    number,
    number,
    number,
    number,
  ];
  const left = Math.min(Math.max(0, x), bounds.width);
  const top = Math.min(Math.max(0, y), bounds.height);
  const right = Math.min(Math.max(left, x + width), bounds.width);
  const bottom = Math.min(Math.max(top, y + height), bounds.height);
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Wait before retrying a page that failed to load (a local dashboard not started yet). */
export const LOAD_RETRY_MS = 10_000;

/** Chromium's "aborted" load error: a newer navigation replaced the load, nothing failed. */
export const ERR_ABORTED = -3;

/** Whether a failed load should be retried later. */
export function shouldRetryLoad(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== ERR_ABORTED;
}
