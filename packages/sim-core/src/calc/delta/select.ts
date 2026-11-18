import type { SessionType } from "../../model/sim-state";
import type { DeltaReferenceKind, DeltaReferenceMode } from "./types";

type Available = Partial<Record<DeltaReferenceKind, unknown>>;

export interface AutoReferenceInput {
  sessionType: SessionType | null;
  /** SessionInfo.typeName; "Offline Testing" (any case) selects the last lap. */
  sessionTypeName: string | null;
  /** Lap in progress (1 = first lap); null when unknown. */
  lapNumber: number | null;
  /** Kinds with a valid lap; only the keys are read. */
  available: Available;
}

function has(available: Available, kind: DeltaReferenceKind): boolean {
  return Object.prototype.hasOwnProperty.call(available, kind);
}

function fallback(available: Available): DeltaReferenceKind | null {
  return has(available, "lastLap") ? "lastLap" : null;
}

/** The session's reference (plan decision 15). */
export function autoReferenceKind(input: AutoReferenceInput): DeltaReferenceKind | null {
  const { sessionType, sessionTypeName, lapNumber, available } = input;
  let pick: DeltaReferenceKind;
  if (sessionType === "race" && lapNumber !== null && lapNumber <= 2) pick = "lastLap";
  else if (sessionTypeName !== null && /^offline testing$/i.test(sessionTypeName.trim()))
    pick = "lastLap";
  else if (sessionType === "qualifying") pick = "allTimeBest";
  else pick = has(available, "sessionBestClean") ? "sessionBestClean" : "sessionBest";
  return has(available, pick) ? pick : fallback(available);
}

/** The reference for the overlay's mode; "auto" uses autoKind. Falls back to the last lap, then null. */
export function resolveReferenceKind(
  mode: DeltaReferenceMode,
  autoKind: DeltaReferenceKind | null,
  available: Available,
): DeltaReferenceKind | null {
  let pick: DeltaReferenceKind | null;
  switch (mode) {
    case "auto":
      pick = autoKind;
      break;
    case "sessionBest":
      pick = has(available, "sessionBestClean") ? "sessionBestClean" : "sessionBest";
      break;
    case "allTimeBest":
      pick = "allTimeBest";
      break;
    case "lastLap":
      pick = "lastLap";
      break;
  }
  return pick !== null && has(available, pick) ? pick : fallback(available);
}

/** A stored option value as a mode; anything unknown is "auto". */
export function parseReferenceMode(value: unknown): DeltaReferenceMode {
  return value === "sessionBest" || value === "allTimeBest" || value === "lastLap" ? value : "auto";
}

/** Display label: "All-time best", "Session best" (both session kinds), "Last lap". */
export function referenceLabel(kind: DeltaReferenceKind): string {
  switch (kind) {
    case "allTimeBest":
      return "All-time best";
    case "sessionBestClean":
    case "sessionBest":
      return "Session best";
    case "lastLap":
      return "Last lap";
  }
}
