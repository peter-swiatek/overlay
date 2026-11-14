import { useEffect, useReducer } from "react";
import {
  INITIAL_CHAT_STATE,
  applyChatEvent,
  type ChatEvent,
  type ChatState,
} from "@overlay/overlays/twitch-chat";

function reduce(state: ChatState, event: ChatEvent): ChatState {
  return applyChatEvent(state, event);
}

/** This window's Twitch chat: a snapshot from main on mount, then each event as it comes. */
export function useTwitchChat(): ChatState {
  const [state, dispatch] = useReducer(reduce, INITIAL_CHAT_STATE);
  useEffect(() => window.overlayApi.onTwitchChat(dispatch), []);
  return state;
}
