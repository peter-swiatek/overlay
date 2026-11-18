import { describe, expect, it } from "vitest";
import { isEmptyOrTwitchChannel, parseTwitchChannel, storedTwitchChannel } from "./channel";

describe("parseTwitchChannel", () => {
  it("accepts a login, with or without #, in lower case", () => {
    expect(parseTwitchChannel("Some_Channel")).toBe("some_channel");
    expect(parseTwitchChannel("  #some_channel ")).toBe("some_channel");
    expect(parseTwitchChannel("abc")).toBe("abc");
    expect(parseTwitchChannel("a".repeat(25))).toBe("a".repeat(25));
  });

  it("takes the login out of a twitch.tv address", () => {
    expect(parseTwitchChannel("twitch.tv/Some_Channel")).toBe("some_channel");
    expect(parseTwitchChannel("https://www.twitch.tv/some_channel")).toBe("some_channel");
    expect(parseTwitchChannel("https://www.twitch.tv/some_channel/videos?x=1")).toBe(
      "some_channel",
    );
    expect(parseTwitchChannel("http://m.twitch.tv/some_channel/")).toBe("some_channel");
  });

  it("refuses names a login cannot have and other sites", () => {
    for (const bad of [
      "",
      "  ",
      "ab",
      "a".repeat(26),
      "two words",
      "name-with-dash",
      "näme",
      "#",
      "##name",
      "name\r\nJOIN #x",
      "https://example.com/some_channel",
      "https://twitch.tv/",
      "https://user:pw@twitch.tv/some_channel",
      "ftp://twitch.tv/some_channel",
      "javascript:alert(1)",
      "x".repeat(200),
    ]) {
      expect(parseTwitchChannel(bad), bad).toBeNull();
    }
    expect(parseTwitchChannel(42)).toBeNull();
  });

  it("stores the login, empty for blank, refuses the rest", () => {
    expect(storedTwitchChannel(" #Some_Channel ")).toBe("some_channel");
    expect(storedTwitchChannel("  ")).toBe("");
    expect(storedTwitchChannel("no good")).toBeNull();
    expect(storedTwitchChannel(null)).toBeNull();
    expect(isEmptyOrTwitchChannel("")).toBe(true);
    expect(isEmptyOrTwitchChannel("twitch.tv/abc")).toBe(true);
    expect(isEmptyOrTwitchChannel("a b")).toBe(false);
  });
});
