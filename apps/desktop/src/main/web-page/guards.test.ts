import { describe, expect, it, vi } from "vitest";
import {
  ERR_ABORTED,
  WEB_PAGE_PARTITION_PREFIX,
  WINDOW_OPEN_DENIED,
  buildWebPagePreferences,
  guardWebPageContents,
  hardenWebPageSession,
  isAllowedNavigation,
  isAllowedRequest,
  isPermissionAllowed,
  pageBackground,
  pageCss,
  pageZoomFactor,
  parsePageRect,
  partitionFor,
  shouldRetryLoad,
  type GuardedContents,
  type GuardedSession,
} from "./guards";

type Handler = (...args: unknown[]) => unknown;

/** Records every handler an installer registers, by method or event name. */
function recorder() {
  const handlers = new Map<string, Handler>();
  const set = (name: string) => (handler: Handler) => void handlers.set(name, handler);
  const on = (event: string, handler: Handler) => void handlers.set(`on:${event}`, handler);
  const get = (name: string): Handler => {
    const h = handlers.get(name);
    if (!h) throw new Error(`no handler for ${name}`);
    return h;
  };
  return { handlers, set, on, get };
}

function fakeSession() {
  const r = recorder();
  const spell = vi.fn();
  const ses = {
    setPermissionRequestHandler: r.set("permissionRequest"),
    setPermissionCheckHandler: r.set("permissionCheck"),
    setDevicePermissionHandler: r.set("devicePermission"),
    setDisplayMediaRequestHandler: r.set("displayMedia"),
    setBluetoothPairingHandler: r.set("bluetoothPairing"),
    setSpellCheckerEnabled: spell,
    on: r.on,
    webRequest: { onBeforeRequest: r.set("beforeRequest") },
  } as unknown as GuardedSession;
  hardenWebPageSession(ses);
  return { ...r, spell };
}

function fakeContents() {
  const r = recorder();
  const contents = {
    setWindowOpenHandler: r.set("windowOpen"),
    on: r.on,
  } as unknown as GuardedContents;
  guardWebPageContents(contents);
  return r;
}

function navEvent(url: string, isMainFrame = true) {
  return { url, isMainFrame, preventDefault: vi.fn() };
}

describe("partitionFor", () => {
  it("gives each instance its own persistent partition, apart from the app's", () => {
    expect(partitionFor("webview")).toBe("persist:webview-1");
    expect(partitionFor("webview:2")).toBe("persist:webview-2");
    expect(partitionFor("webview:12")).toBe("persist:webview-12");
    expect(partitionFor("webview")).toMatch(new RegExp(`^${WEB_PAGE_PARTITION_PREFIX}`));
  });
});

describe("buildWebPagePreferences", () => {
  const prefs = buildWebPagePreferences("persist:webview-1");

  it("isolates the page: no Node, sandbox and context isolation on, no preload", () => {
    expect(prefs).toMatchObject({
      partition: "persist:webview-1",
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      disableDialogs: true,
    });
    expect("preload" in prefs).toBe(false);
  });
});

describe("isAllowedNavigation", () => {
  it("lets pages move between http(s) addresses only", () => {
    expect(isAllowedNavigation("http://127.0.0.1:8888/Dash")).toBe(true);
    expect(isAllowedNavigation("https://example.com/login")).toBe(true);
    for (const url of [
      "file:///C:/Users/me/secret.txt",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "chrome://settings",
      "devtools://devtools/",
      "about:blank",
      "ms-settings:privacy",
      "http://user:pw@localhost/",
      "",
    ]) {
      expect(isAllowedNavigation(url), url).toBe(false);
    }
  });
});

describe("isAllowedRequest", () => {
  it("allows web resources and refuses local and internal schemes", () => {
    for (const url of [
      "http://localhost/a.js",
      "https://cdn.example.com/x.css",
      "ws://localhost:8888/socket",
      "wss://example.com/live",
      "data:image/png;base64,AAAA",
      "blob:http://localhost/1234",
    ]) {
      expect(isAllowedRequest(url), url).toBe(true);
    }
    for (const url of [
      "file:///C:/Windows/win.ini",
      "chrome-extension://abc/x.js",
      "devtools://devtools/x",
      "chrome://gpu",
      "not a url",
    ]) {
      expect(isAllowedRequest(url), url).toBe(false);
    }
  });
});

describe("hardenWebPageSession", () => {
  it("refuses every permission request and check", () => {
    const s = fakeSession();
    for (const permission of [
      "media",
      "geolocation",
      "notifications",
      "clipboard-read",
      "midi",
      "pointerLock",
      "fullscreen",
      "openExternal",
      "display-capture",
    ]) {
      expect(isPermissionAllowed(permission)).toBe(false);
      const callback = vi.fn();
      s.get("permissionRequest")(null, permission, callback, {});
      expect(callback).toHaveBeenCalledWith(false);
      expect(s.get("permissionCheck")(null, permission, "http://localhost", {})).toBe(false);
    }
    expect(s.get("devicePermission")({ deviceType: "hid" })).toBe(false);
  });

  it("refuses screen capture, Bluetooth pairing and device pickers, and cancels downloads", () => {
    const s = fakeSession();
    const media = vi.fn();
    s.get("displayMedia")({}, media);
    expect(media).toHaveBeenCalledWith(null);
    const pair = vi.fn();
    s.get("bluetoothPairing")({}, pair);
    expect(pair).toHaveBeenCalledWith({ confirmed: false });
    const download = { preventDefault: vi.fn() };
    s.get("on:will-download")(download);
    expect(download.preventDefault).toHaveBeenCalled();
    for (const [event, args] of [
      ["select-hid-device", [{}]],
      ["select-serial-port", [[], {}]],
      ["select-usb-device", [{}]],
    ] as const) {
      const e = { preventDefault: vi.fn() };
      const pick = vi.fn();
      s.get(`on:${event}`)(e, ...args, pick);
      expect(e.preventDefault, event).toHaveBeenCalled();
      expect(pick, event).toHaveBeenCalledTimes(1);
      expect(pick.mock.calls[0]?.[0] ?? null, event).toBeFalsy();
    }
    expect(s.spell).toHaveBeenCalledWith(false);
  });

  it("cancels requests to non-web schemes", () => {
    const s = fakeSession();
    const cb = vi.fn();
    s.get("beforeRequest")({ url: "file:///C:/x.txt" }, cb);
    expect(cb).toHaveBeenLastCalledWith({ cancel: true });
    s.get("beforeRequest")({ url: "http://localhost:8888/app.js" }, cb);
    expect(cb).toHaveBeenLastCalledWith({ cancel: false });
  });
});

describe("guardWebPageContents", () => {
  it("denies every new window", () => {
    const c = fakeContents();
    expect(c.get("windowOpen")({ url: "https://example.com" })).toEqual(WINDOW_OPEN_DENIED);
    expect(c.get("windowOpen")({ url: "file:///x" })).toEqual({ action: "deny" });
  });

  it("stops navigations and redirects to non-http(s) addresses", () => {
    const c = fakeContents();
    for (const event of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
      const bad = navEvent("file:///C:/x");
      c.get(`on:${event}`)(bad);
      expect(bad.preventDefault, event).toHaveBeenCalled();
      const js = navEvent("javascript:alert(1)");
      c.get(`on:${event}`)(js);
      expect(js.preventDefault, event).toHaveBeenCalled();
      const ok = navEvent("https://example.com/next");
      c.get(`on:${event}`)(ok);
      expect(ok.preventDefault, event).not.toHaveBeenCalled();
    }
  });

  it("leaves sub-frame navigations to the request filter", () => {
    const c = fakeContents();
    const frame = navEvent("about:srcdoc", false);
    c.get("on:will-frame-navigate")(frame);
    expect(frame.preventDefault).not.toHaveBeenCalled();
  });

  it("refuses nested webviews and Bluetooth device pickers", () => {
    const c = fakeContents();
    const attach = { preventDefault: vi.fn() };
    c.get("on:will-attach-webview")(attach);
    expect(attach.preventDefault).toHaveBeenCalled();
    const pick = { preventDefault: vi.fn() };
    const cb = vi.fn();
    c.get("on:select-bluetooth-device")(pick, [], cb);
    expect(pick.preventDefault).toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith("");
  });
});

describe("pageCss", () => {
  const none = { transparent: false, hideScrollbars: false, opacityPct: 100, blockInput: false };

  it("forces nothing when every option is off", () => {
    expect(pageCss(none)).toBe("");
  });

  it("clears the page background when transparent", () => {
    expect(pageCss({ ...none, transparent: true })).toContain(
      "html, body { background: transparent !important; }",
    );
  });

  it("hides scrollbars both ways", () => {
    const css = pageCss({ ...none, hideScrollbars: true });
    expect(css).toContain("scrollbar-width: none !important");
    expect(css).toContain("::-webkit-scrollbar { display: none !important");
  });

  it("carries the overlay opacity", () => {
    expect(pageCss({ ...none, opacityPct: 60 })).toContain("html { opacity: 0.6 !important; }");
  });

  it("blocks the page's input while unlocked without interaction", () => {
    const css = pageCss({ ...none, blockInput: true });
    expect(css).toContain("pointer-events: none !important");
    expect(css).toContain("-webkit-app-region: drag");
  });
});

describe("pageZoomFactor / pageBackground / shouldRetryLoad", () => {
  it("multiplies the page zoom by the overlay scale within Chromium's range", () => {
    expect(pageZoomFactor(100, 100)).toBe(1);
    expect(pageZoomFactor(150, 100)).toBe(1.5);
    expect(pageZoomFactor(50, 50)).toBe(0.25);
    expect(pageZoomFactor(200, 200)).toBe(4);
    expect(pageZoomFactor(Number.NaN, 100)).toBe(1);
  });

  it("is see-through when transparent, white otherwise", () => {
    expect(pageBackground(true)).toBe("#00000000");
    expect(pageBackground(false)).toBe("#ffffffff");
  });

  it("retries failed main-frame loads, not aborted ones or sub-frames", () => {
    expect(shouldRetryLoad(-102, true)).toBe(true);
    expect(shouldRetryLoad(ERR_ABORTED, true)).toBe(false);
    expect(shouldRetryLoad(-102, false)).toBe(false);
  });
});

describe("parsePageRect", () => {
  const win = { width: 400, height: 260 };

  it("accepts a rect inside the window, rounded", () => {
    expect(parsePageRect({ x: 0, y: 20.4, width: 400, height: 219.6 }, win)).toEqual({
      x: 0,
      y: 20,
      width: 400,
      height: 220,
    });
  });

  it("clamps to the window", () => {
    expect(parsePageRect({ x: -10, y: 20, width: 9000, height: 9000 }, win)).toEqual({
      x: 0,
      y: 20,
      width: 400,
      height: 240,
    });
  });

  it("refuses malformed or empty rects", () => {
    expect(parsePageRect(null, win)).toBeNull();
    expect(parsePageRect("0,0,10,10", win)).toBeNull();
    expect(parsePageRect({ x: 0, y: 0, width: Number.NaN, height: 10 }, win)).toBeNull();
    expect(parsePageRect({ x: 0, y: 0, width: "10", height: 10 }, win)).toBeNull();
    expect(parsePageRect({ x: 0, y: 0, width: 0, height: 10 }, win)).toBeNull();
    expect(parsePageRect({ x: 500, y: 0, width: 10, height: 10 }, win)).toBeNull();
  });
});
