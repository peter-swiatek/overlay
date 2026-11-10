import type { CarLeftRight } from "../../model";

export interface ProximityCar {
  carIdx: number;
  /** Metres along the track; positive = that car's centre is ahead of ours. */
  longitudinalM: number;
  /** Metres sideways; positive = to our right. Null when the sim gives no positions (iRacing). */
  lateralM: number | null;
  side: "left" | "right" | null;
}

export interface Proximity {
  /** The sim's spotter call (iRacing) or one derived from positions (LMU). */
  carLeftRight: CarLeftRight;
  /**
   * Nearest car on each side as an offset in car lengths: -1 = its nose at our tail, 0 = level,
   * 1 = its tail at our nose. Null = clear on that side.
   */
  left: number | null;
  right: number | null;
  /** Cars within NEARBY_M (40 m) along the track, nearest first. */
  nearby: ProximityCar[];
  carLengthM: number;
}
