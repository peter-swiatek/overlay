import { LOCKED_COLOURS } from "@overlay/theme";
import type { ChatMessage } from "./types";

/**
 * Edit-mode and preview example: made-up people and messages, shown only while no live chat is
 * available (never mixed with a real channel's messages).
 */
export const SAMPLE_CHANNEL = "example_channel";

export function sampleMessages(nowMs: number): ChatMessage[] {
  const at = (minutesAgo: number) => nowMs - minutesAgo * 60_000;
  const base = { userId: null, emotes: [], action: false } as const;
  return [
    {
      ...base,
      id: "sample-1",
      login: "pit_wall_pal",
      name: "Pit_Wall_Pal",
      color: LOCKED_COLOURS.shift,
      role: "moderator",
      text: "Clean opening stint, tyres look good.",
      sentAt: at(3),
      receivedAt: at(3),
    },
    {
      ...base,
      id: "sample-2",
      login: "apex_otter",
      name: "Apex_Otter",
      color: null,
      role: "subscriber",
      text: "Gap to the car behind is coming down, keep pushing!",
      sentAt: at(2),
      receivedAt: at(2),
    },
    {
      ...base,
      id: "sample-3",
      login: "late_braker42",
      name: "late_braker42",
      color: LOCKED_COLOURS.flagYellow,
      role: null,
      text: "watching from the grandstand",
      action: true,
      sentAt: at(2),
      receivedAt: at(2),
    },
    {
      ...base,
      id: "sample-4",
      login: "slipstream_sam",
      name: "Slipstream_Sam",
      color: LOCKED_COLOURS.gain,
      role: "vip",
      text: "How many laps until the pit window opens?",
      sentAt: at(1),
      receivedAt: at(1),
    },
    {
      ...base,
      id: "sample-5",
      login: SAMPLE_CHANNEL,
      name: "Example_Channel",
      color: LOCKED_COLOURS.pitExit,
      role: "broadcaster",
      text: "Pitting in two laps, thanks for watching everyone.",
      sentAt: at(0),
      receivedAt: at(0),
    },
  ];
}
