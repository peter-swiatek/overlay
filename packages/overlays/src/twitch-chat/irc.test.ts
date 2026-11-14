import { describe, expect, it } from "vitest";
import {
  chatEventOf,
  chatMessageOf,
  cleanText,
  messageSegments,
  nickOf,
  parseBadges,
  parseEmotes,
  parseIrcLine,
  roleOf,
  unescapeTagValue,
  type IrcMessage,
} from "./irc";

const T = 1_700_000_000_000;
const noId = () => "local-1";

function parse(line: string): IrcMessage {
  const msg = parseIrcLine(line);
  if (msg === null) throw new Error(`not parsed: ${line}`);
  return msg;
}

const PRIVMSG =
  "@badge-info=subscriber/8;badges=moderator/1,subscriber/6;color=#1E90FF;display-name=Tyre_Whisperer;" +
  "emotes=;id=b34ccfc7-4977-403a-8a94-33c6bac34fb8;mod=1;tmi-sent-ts=1700000001234;user-id=4242 " +
  ":tyre_whisperer!tyre_whisperer@tyre_whisperer.tmi.twitch.tv PRIVMSG #some_channel :Box this lap? 1:40.00 pace";

describe("parseIrcLine", () => {
  it("splits tags, prefix, command and parameters", () => {
    const msg = parse(PRIVMSG);
    expect(msg.command).toBe("PRIVMSG");
    expect(msg.prefix).toBe("tyre_whisperer!tyre_whisperer@tyre_whisperer.tmi.twitch.tv");
    expect(msg.params).toEqual(["#some_channel", "Box this lap? 1:40.00 pace"]);
    expect(msg.tags["display-name"]).toBe("Tyre_Whisperer");
    expect(msg.tags["emotes"]).toBe("");
    expect(msg.tags["mod"]).toBe("1");
  });

  it("reads lines without tags or prefix, numeric replies and CR LF endings", () => {
    expect(parse("PING :tmi.twitch.tv\r\n")).toEqual({
      tags: {},
      prefix: null,
      command: "PING",
      params: ["tmi.twitch.tv"],
    });
    const welcome = parse(":tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!");
    expect(welcome.command).toBe("001");
    expect(welcome.params).toEqual(["justinfan12345", "Welcome, GLHF!"]);
    expect(parse(":tmi.twitch.tv RECONNECT").params).toEqual([]);
  });

  it("keeps colons and spaces inside the trailing parameter, and an empty one", () => {
    expect(parse(":a!a@a PRIVMSG #c :  :) hi :x").params).toEqual(["#c", "  :) hi :x"]);
    expect(parse(":a!a@a PRIVMSG #c :").params).toEqual(["#c", ""]);
  });

  it("reads tags without values and ignores empty ones", () => {
    const msg = parse("@a;b=;;c=1 :tmi.twitch.tv ROOMSTATE #c");
    expect(msg.tags).toEqual({ a: "", b: "", c: "1" });
  });

  it("refuses lines that are not messages", () => {
    expect(parseIrcLine("")).toBeNull();
    expect(parseIrcLine("@only-tags")).toBeNull();
    expect(parseIrcLine(":prefix-only")).toBeNull();
    expect(parseIrcLine("<b>html</b>")).toBeNull();
    expect(parseIrcLine("12 x")).toBeNull();
  });

  it("does not let a tag named __proto__ reach the prototype", () => {
    const msg = parse("@__proto__=x;ok=1 :tmi.twitch.tv PING");
    expect(msg.tags).toEqual({ ok: "1" });
    expect(Object.getPrototypeOf(msg.tags)).toBe(Object.prototype);
  });
});

describe("unescapeTagValue", () => {
  it("unescapes the IRCv3 sequences", () => {
    expect(unescapeTagValue("a\\sb\\:c\\\\d")).toBe("a b;c\\d");
    expect(unescapeTagValue("x\\ry\\nz")).toBe("x\ry\nz");
    expect(unescapeTagValue("\\q")).toBe("q");
    expect(unescapeTagValue("end\\")).toBe("end");
  });
});

describe("nickOf / badges / emotes", () => {
  it("takes the lowercase nick of a user prefix only", () => {
    expect(nickOf("Some_Nick!some_nick@some_nick.tmi.twitch.tv")).toBe("some_nick");
    expect(nickOf("tmi.twitch.tv")).toBeNull();
    expect(nickOf(null)).toBeNull();
  });

  it("picks the highest role", () => {
    expect(roleOf(parseBadges("subscriber/12,broadcaster/1"))).toBe("broadcaster");
    expect(roleOf(parseBadges("subscriber/12,moderator/1"))).toBe("moderator");
    expect(roleOf(parseBadges("vip/1,subscriber/3"))).toBe("vip");
    expect(roleOf(parseBadges("founder/0"))).toBe("subscriber");
    expect(roleOf(parseBadges("premium/1,glhf-pledge/1"))).toBeNull();
    expect(roleOf(parseBadges(""))).toBeNull();
    expect(roleOf(parseBadges(undefined))).toBeNull();
  });

  it("parses emote ranges, sorted, without malformed or overlapping ones", () => {
    expect(parseEmotes("25:0-4,12-16/1902:6-10")).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
      { start: 12, end: 16 },
    ]);
    expect(parseEmotes("1:5-2,x-3,4-4/2:4-6")).toEqual([{ start: 4, end: 4 }]);
    expect(parseEmotes("")).toEqual([]);
    expect(parseEmotes("garbage")).toEqual([]);
  });

  it("splits text into plain and emote runs by code point", () => {
    expect(messageSegments("Kappa hi Kappa", parseEmotes("25:0-4,9-13"))).toEqual([
      { text: "Kappa", emote: true },
      { text: " hi ", emote: false },
      { text: "Kappa", emote: true },
    ]);
    // An emoji is two UTF-16 units but one code point, as Twitch counts.
    expect(messageSegments("😀 Kappa", [{ start: 2, end: 6 }])).toEqual([
      { text: "😀 ", emote: false },
      { text: "Kappa", emote: true },
    ]);
    // A range past the end is ignored.
    expect(messageSegments("hi", [{ start: 0, end: 9 }])).toEqual([{ text: "hi", emote: false }]);
    expect(messageSegments("", [])).toEqual([]);
  });

  it("removes control characters and cuts long text", () => {
    expect(cleanText("a\u0000b\nc\u0007d\u009f", 100)).toBe("abcd");
    expect(cleanText("x".repeat(20), 5)).toBe("xxxxx");
  });
});

describe("chatMessageOf", () => {
  it("reads name, colour, role, id, user id and Twitch's time", () => {
    const m = chatMessageOf(parse(PRIVMSG), "some_channel", T, noId);
    expect(m).toEqual({
      id: "b34ccfc7-4977-403a-8a94-33c6bac34fb8",
      login: "tyre_whisperer",
      userId: "4242",
      name: "Tyre_Whisperer",
      color: "#1e90ff",
      role: "moderator",
      text: "Box this lap? 1:40.00 pace",
      action: false,
      emotes: [],
      sentAt: 1700000001234,
      receivedAt: T,
    });
  });

  it("falls back to the login, no colour, arrival time and a local id", () => {
    const m = chatMessageOf(
      parse(":quiet_one!quiet_one@x PRIVMSG #some_channel :hello"),
      "some_channel",
      T,
      noId,
    );
    expect(m).toMatchObject({
      id: "local-1",
      name: "quiet_one",
      color: null,
      role: null,
      userId: null,
      sentAt: T,
    });
  });

  it("refuses malformed colours and ids", () => {
    const m = chatMessageOf(
      parse('@color=red;id=<x>;user-id=abc :a_b!a_b@x PRIVMSG #some_channel :"<img src=x>"'),
      "some_channel",
      T,
      noId,
    );
    expect(m?.color).toBeNull();
    expect(m?.id).toBe("local-1");
    expect(m?.userId).toBeNull();
    // Markup stays text: React renders it as characters.
    expect(m?.text).toBe('"<img src=x>"');
  });

  it("unwraps /me messages and marks them as actions", () => {
    const m = chatMessageOf(
      parse(":a_b!a_b@x PRIVMSG #some_channel :\u0001ACTION waves at the pit crew\u0001"),
      "some_channel",
      T,
      noId,
    );
    expect(m?.action).toBe(true);
    expect(m?.text).toBe("waves at the pit crew");
  });

  it("keeps emote ranges, unless cleaning changed the text", () => {
    const line = (text: string) =>
      parse(`@emotes=25:0-4 :a_b!a_b@x PRIVMSG #some_channel :${text}`);
    expect(chatMessageOf(line("Kappa go"), "some_channel", T, noId)?.emotes).toEqual([
      { start: 0, end: 4 },
    ]);
    expect(chatMessageOf(line("\u0007Kappa go"), "some_channel", T, noId)?.emotes).toEqual([]);
  });

  it("ignores other channels, server senders and short lines", () => {
    expect(chatMessageOf(parse(PRIVMSG), "other_channel", T, noId)).toBeNull();
    expect(
      chatMessageOf(parse(":tmi.twitch.tv PRIVMSG #some_channel :x"), "some_channel", T, noId),
    ).toBeNull();
    expect(
      chatMessageOf(parse(":a!a@x PRIVMSG #some_channel"), "some_channel", T, noId),
    ).toBeNull();
  });

  it("matches the channel case-insensitively and cleans the display name", () => {
    const m = chatMessageOf(
      parse("@display-name=Fast\\sLane :fast_lane!f@x PRIVMSG #Some_Channel :hi"),
      "some_channel",
      T,
      noId,
    );
    expect(m?.name).toBe("Fast Lane");
  });
});

describe("chatEventOf", () => {
  const ch = "some_channel";
  it("turns PRIVMSG into a message event", () => {
    expect(chatEventOf(parse(PRIVMSG), ch, T, noId)?.type).toBe("message");
  });

  it("turns CLEARCHAT with a user into a clear of that user, without one into a full clear", () => {
    expect(
      chatEventOf(
        parse(
          "@ban-duration=600;target-user-id=4242 :tmi.twitch.tv CLEARCHAT #some_channel :Tyre_Whisperer",
        ),
        ch,
        T,
        noId,
      ),
    ).toEqual({ type: "clear-user", login: "tyre_whisperer", userId: "4242" });
    expect(chatEventOf(parse(":tmi.twitch.tv CLEARCHAT #some_channel"), ch, T, noId)).toEqual({
      type: "clear-all",
    });
    expect(
      chatEventOf(parse(":tmi.twitch.tv CLEARCHAT #some_channel :bad user"), ch, T, noId),
    ).toBeNull();
    expect(chatEventOf(parse(":tmi.twitch.tv CLEARCHAT #other"), ch, T, noId)).toBeNull();
  });

  it("turns CLEARMSG into a delete of that message", () => {
    expect(
      chatEventOf(
        parse("@login=a_b;target-msg-id=abc-123 :tmi.twitch.tv CLEARMSG #some_channel :oops"),
        ch,
        T,
        noId,
      ),
    ).toEqual({ type: "delete", id: "abc-123" });
    expect(
      chatEventOf(parse(":tmi.twitch.tv CLEARMSG #some_channel :oops"), ch, T, noId),
    ).toBeNull();
  });

  it("ignores everything else", () => {
    for (const line of [
      ":tmi.twitch.tv ROOMSTATE #some_channel",
      "PING :tmi.twitch.tv",
      ":a!a@x JOIN #some_channel",
      "@msg-id=sub :tmi.twitch.tv USERNOTICE #some_channel :hi",
    ]) {
      expect(chatEventOf(parse(line), ch, T, noId)).toBeNull();
    }
  });
});
