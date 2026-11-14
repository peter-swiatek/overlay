import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { nameColour } from "./colour";
import { twitchChatManifest } from "./manifest";
import { TWITCH_CHAT_KEYS as K, TWITCH_CHAT_OVERLAY_ID, twitchChatOptions } from "./options";
import { SAMPLE_CHANNEL } from "./sample";
import type { ChatState } from "./state";
import type { ChatMessage, ChatStatus } from "./types";
import { NO_CHANNEL_TEXT, TwitchChatOverlay, footerTexts, statusText } from "./TwitchChatOverlay";

const NOW = new Date(2026, 10, 14, 17, 33, 0).getTime();

function msg(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    login: `user_${id}`,
    userId: null,
    name: `User_${id}`,
    color: null,
    role: null,
    text: `message ${id}`,
    action: false,
    emotes: [],
    sentAt: NOW - 60_000,
    receivedAt: NOW - 5_000,
    ...over,
  };
}

type Options = Record<string, boolean | number | string>;

function settingsWith(options: Options = {}) {
  return applySettingsPatch(twitchChatManifest, defaultInstanceSettings(twitchChatManifest), {
    options,
  });
}

const connected: ChatStatus = { state: "connected", notice: null };

function chat(over: Partial<ChatState> = {}): () => ChatState {
  const state: ChatState = { channel: "some_channel", status: connected, messages: [], ...over };
  return () => state;
}

function render(options: Options = {}, runtime: Partial<OverlayRuntime> = {}): string {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(null, runtime)}>
      <TwitchChatOverlay settings={settingsWith(options)} />
    </OverlayRuntimeContext.Provider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("twitch chat manifest", () => {
  it("is a 320 x 360 overlay for both sims, off by default, without telemetry, and registered", () => {
    const m = twitchChatManifest;
    expect(m.id).toBe(TWITCH_CHAT_OVERLAY_ID);
    expect(m.title).toBe("Twitch Chat");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 320, height: 360 });
    expect(m.defaultEnabled).toBe(false);
    expect(m.needsTelemetry).toBe(false);
    expect(m.editTitleBarInFlow).toBe(true);
    expect(m.table).toBe(false);
    expect(manifestById("twitch-chat")).toBe(m);
    expect(moduleById("twitch-chat")?.Component).toBe(TwitchChatOverlay);
  });

  it("defaults to no channel, bottom-up, a 45 s fade, 50 messages, timestamps, badges and header", () => {
    expect(twitchChatOptions(defaultInstanceSettings(twitchChatManifest))).toEqual({
      channel: null,
      direction: "bottom-up",
      fadeS: 45,
      maxMessages: 50,
      timestamps: true,
      badges: true,
      hideCommands: false,
      header: true,
    });
  });

  it("stores the channel as a login and refuses names that are not one", () => {
    expect(
      settingsWith({ [K.channel]: "https://www.twitch.tv/Some_Channel" }).options[K.channel],
    ).toBe("some_channel");
    expect(settingsWith({ [K.channel]: "#Some_Channel" }).options[K.channel]).toBe("some_channel");
    const base = settingsWith({ [K.channel]: "some_channel" });
    const refused = applySettingsPatch(twitchChatManifest, base, {
      options: { [K.channel]: "not a channel" },
    });
    expect(refused.options[K.channel]).toBe("some_channel");
    const cleared = applySettingsPatch(twitchChatManifest, base, { options: { [K.channel]: " " } });
    expect(cleared.options[K.channel]).toBe("");
  });

  it("reads odd stored options safely", () => {
    const o = twitchChatOptions({
      options: {
        [K.fade]: "off",
        [K.maxMessages]: 9999,
        [K.direction]: "sideways",
        [K.channel]: 5,
      },
    });
    expect(o).toMatchObject({
      fadeS: null,
      maxMessages: 150,
      direction: "bottom-up",
      channel: null,
    });
    expect(twitchChatOptions({ options: { [K.fade]: "120" } }).fadeS).toBe(120);
  });

  it("styles with theme tokens and locked colours only, sized in em", () => {
    const css = readFileSync(join(import.meta.dirname, "twitch-chat.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).toContain("font-size: var(--ov-font-size, 14px)");
    expect(css).toContain("var(--ov-locked-fastest)");
  });
});

describe("twitch chat overlay in a window", () => {
  it("shows nothing while driving without a channel", () => {
    expect(render({}, { useTwitchChat: chat() })).toBe("");
  });

  it("shows the sample with a hint in edit mode without a channel", () => {
    const html = render({}, { editing: true, useTwitchChat: chat() });
    expect(html).toContain(NO_CHANNEL_TEXT);
    expect(html).toContain("No channel");
    expect(html).toContain('data-sample="true"');
    expect(html).toContain("Pit_Wall_Pal");
    expect(html).toContain("Direction: Bottom-up");
    expect(html).toContain("Fade: 45s");
  });

  it("shows the channel's messages with time, badge, coloured name and text", () => {
    const html = render(
      { [K.channel]: "some_channel" },
      {
        useTwitchChat: chat({
          messages: [
            msg("a", { role: "moderator", color: "#1e90ff", name: "Tyre_Whisperer" }),
            msg("b", { role: "broadcaster", name: "Some_Channel" }),
          ],
        }),
      },
    );
    expect(html).toContain("#some_channel");
    expect(html).toContain('data-live="true"');
    expect(html).toContain(">17:32<");
    expect(html).toContain('class="tc-badge tc-badge--moderator">MOD<');
    expect(html).toContain('class="tc-badge tc-badge--broadcaster">BCAST<');
    expect(html).toContain(`color:${nameColour("#1e90ff", "user_a")}`);
    expect(html).toContain("Tyre_Whisperer:");
    expect(html).toContain("message a");
    expect(html).toContain("tc-msg tc-msg--broadcaster");
    expect(html).not.toContain("data-sample");
    expect(html).not.toContain("Pit_Wall_Pal");
    // Settings info only while editing; no viewer count (anonymous chat has none).
    expect(html).not.toContain("Direction:");
    expect(html).not.toContain("Viewers");
    expect(html.indexOf("message a")).toBeLessThan(html.indexOf("message b"));
  });

  it("puts the newest first top-down", () => {
    const html = render(
      { [K.channel]: "some_channel", [K.direction]: "top-down" },
      { useTwitchChat: chat({ messages: [msg("a"), msg("b")] }) },
    );
    expect(html.indexOf("message b")).toBeLessThan(html.indexOf("message a"));
    expect(html).toContain('data-direction="top-down"');
  });

  it("renders markup in messages as text", () => {
    const html = render(
      { [K.channel]: "some_channel" },
      { useTwitchChat: chat({ messages: [msg("a", { text: "<img src=x onerror=alert(1)>" })] }) },
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("shows /me messages in italics in the name colour, and emotes as text", () => {
    const html = render(
      { [K.channel]: "some_channel" },
      {
        useTwitchChat: chat({
          messages: [
            msg("a", { action: true, text: "waves", color: "#ff7f50" }),
            msg("b", { text: "Kappa go", emotes: [{ start: 0, end: 4 }] }),
          ],
        }),
      },
    );
    expect(html).toContain('class="tc-text tc-text--action" style="color:#ff7f50"');
    expect(html).toContain("User_a</span>");
    expect(html).toContain('<span class="tc-emote">Kappa</span> go');
  });

  it("drops faded messages and starts fading the last second", () => {
    const html = render(
      { [K.channel]: "some_channel", [K.fade]: "15" },
      {
        useTwitchChat: chat({
          messages: [
            msg("gone", { receivedAt: NOW - 15_000 }),
            msg("going", { receivedAt: NOW - 14_500 }),
            msg("fresh", { receivedAt: NOW - 1_000 }),
          ],
        }),
      },
    );
    expect(html).not.toContain("message gone");
    expect(html).toMatch(/tc-msg tc-msg--out" data-msg="going"/);
    expect(html).toMatch(/class="tc-msg" data-msg="fresh"/);
  });

  it("follows the max, timestamp, badge, command and header settings", () => {
    const html = render(
      {
        [K.channel]: "some_channel",
        [K.maxMessages]: 5,
        [K.timestamps]: false,
        [K.badges]: false,
        [K.hideCommands]: true,
        [K.header]: false,
      },
      {
        useTwitchChat: chat({
          messages: [
            ...["1", "2", "3", "4", "5", "6"].map((id) => msg(id, { role: "vip" })),
            msg("cmd", { text: "!discord" }),
          ],
        }),
      },
    );
    expect(html).not.toContain("message 1<");
    expect(html).toContain("message 6");
    expect(html).not.toContain("!discord");
    expect(html).not.toContain("tc-time");
    expect(html).not.toContain("tc-badge");
    expect(html).not.toContain("#some_channel");
  });

  it("waits for the new channel's messages after a change", () => {
    const html = render(
      { [K.channel]: "new_channel" },
      { useTwitchChat: chat({ channel: "old_channel", messages: [msg("a")] }) },
    );
    expect(html).not.toContain("message a");
    expect(html).toContain("Connecting to #new_channel…");
    expect(html).not.toContain('data-live="true"');
  });

  it("says when it is reconnecting and passes Twitch's notices on", () => {
    expect(
      render(
        { [K.channel]: "some_channel" },
        { useTwitchChat: chat({ status: { state: "reconnecting", notice: null } }) },
      ),
    ).toContain("Disconnected, reconnecting…");
    expect(
      render(
        { [K.channel]: "some_channel" },
        {
          useTwitchChat: chat({
            status: { state: "connected", notice: "This channel is suspended." },
          }),
        },
      ),
    ).toContain("This channel is suspended.");
  });
});

describe("twitch chat overlay in the settings preview", () => {
  it("shows the sample under the channel set, or an example name", () => {
    expect(render()).toContain(`#${SAMPLE_CHANNEL}`);
    const html = render({ [K.channel]: "some_channel" });
    expect(html).toContain("#some_channel");
    expect(html).toContain("Slipstream_Sam");
    expect(html).not.toContain(NO_CHANNEL_TEXT);
  });
});

describe("status and footer texts", () => {
  it("describes the connection", () => {
    expect(statusText(null, "c_c", false, false)).toBe("Connecting to #c_c…");
    expect(statusText({ state: "connecting", notice: null }, "c_c", false, false)).toBe(
      "Connecting to #c_c…",
    );
    expect(statusText(connected, "c_c", false, false)).toBeNull();
    expect(statusText(connected, "c_c", true, true)).toBeNull();
    expect(statusText(connected, "c_c", false, true)).toBe("Connected to #c_c, no messages yet");
  });

  it("names direction and fade", () => {
    const o = twitchChatOptions(settingsWith({ [K.direction]: "top-down", [K.fade]: "off" }));
    expect(footerTexts(o)).toEqual(["Direction: Top-down", "Fade: Off"]);
  });
});
