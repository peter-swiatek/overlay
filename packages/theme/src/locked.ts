import type { LockedColourKey } from "./types";

/** Meaning colours. No theme, import or share code can change them. */
export const LOCKED_COLOURS: Readonly<Record<LockedColourKey, string>> = Object.freeze({
  gain: "#22c55e",
  loss: "#ef4444",
  fastest: "#a855f7",
  licenceR: "#e0322c",
  licenceD: "#f28c28",
  licenceC: "#f2c12e",
  licenceB: "#3bb54a",
  licenceA: "#2f6fde",
  licencePro: "#1a1a1a",
  rejoinYellow: "#facc15",
  rejoinRed: "#ef4444",
  lapFaster: "#22c55e",
  lapSlower: "#ef4444",
  flagGreen: "#16a34a",
  flagYellow: "#facc15",
  flagBlue: "#2563eb",
  flagWhite: "#f8fafc",
  flagRed: "#dc2626",
  flagBlack: "#111111",
  shift: "#38bdf8",
  pitBox: "#38bdf8",
  pitExit: "#e879f9",
  /** Delta Bar sector slower than the reference: yellow, so red stays for real losses elsewhere. */
  sectorSlower: "#facc15",
  /** Tyres overlay: a tyre below its temperature window. */
  tyreCold: "#38bdf8",
  /**
   * Race only: a car that has lapped you or is lapping you (a lap or more ahead on distance), in
   * the sim's own red. A lighter red than loss, so the two stay apart.
   */
  lapAhead: "#f87171",
  /** Race only: a car you have lapped or are lapping (a lap or more behind on distance), in blue. */
  lapBehind: "#2563eb",
});
