import type { CommonOverlaySettings } from "@overlay/overlays/contract";
import type { SimName, TelemetryFrame } from "@overlay/sim-core/types";
import { statusNotice } from "../telemetry/views";

/** What the host needs from the stream to decide whether to show an overlay. */
export interface HostView {
  /** Live frame that is not stale. */
  live: boolean;
  /** The player's car is on track; null when unknown. */
  playerOnTrack: boolean | null;
  sim: SimName | null;
  /** Why there is no data ("Waiting for sim", an error text), or null while live. */
  notice: string | null;
}

/** Host selector; read at a low rate and compared structurally by `useTelemetry`. */
export function hostView(frame: TelemetryFrame | null, stale: boolean): HostView {
  const notice = statusNotice(frame, stale);
  if (frame === null || notice !== null) {
    return { live: false, playerOnTrack: null, sim: null, notice };
  }
  const { state } = frame;
  const player = state.cars.find((car) => car.carIdx === state.playerCarIdx);
  return { live: true, playerOnTrack: player?.isOnTrack ?? null, sim: state.sim, notice: null };
}

export type Visibility = "show" | "notice" | "hidden" | "unsupported";

export interface VisibilityInput {
  live: boolean;
  playerOnTrack: boolean | null;
  sim: SimName | null;
  manifestSims: readonly SimName[];
  common: Pick<CommonOverlaySettings, "hideInGarage" | "hideOnTrack" | "alwaysShow">;
  /** Settings > General > Auto-hide. */
  autoHide: boolean;
  editing: boolean;
}

/**
 * What the overlay window shows. Edit mode keeps every overlay visible so it can be placed, even
 * one that a hide rule would hide; without data it shows the notice.
 */
export function overlayVisibility(input: VisibilityInput): Visibility {
  const { live, playerOnTrack, sim, manifestSims, common, autoHide, editing } = input;
  if (!live) return !editing && autoHide && !common.alwaysShow ? "hidden" : "notice";
  if (sim !== null && !manifestSims.includes(sim)) return "unsupported";
  if (editing) return "show";
  if (common.hideInGarage && playerOnTrack === false) return "hidden";
  if (common.hideOnTrack && playerOnTrack === true) return "hidden";
  return "show";
}

/** The rate an overlay's telemetry subscription runs at: its own request, its manifest and the user's cap. */
export function cappedRateHz(
  requestedHz: number,
  manifestHz: number,
  performanceHz: number,
): number {
  const rate = Math.min(requestedHz, manifestHz, performanceHz);
  return Number.isFinite(rate) && rate >= 1 ? rate : 1;
}

const SIM_LABELS: Readonly<Record<SimName, string>> = { iracing: "iRacing", lmu: "LMU" };

/** Edit-mode note for an overlay the running sim does not support. */
export function unsupportedNote(sim: SimName | null): string {
  return `Not available in ${sim === null ? "this sim" : SIM_LABELS[sim]}`;
}
