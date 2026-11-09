import type { SimState, TyreSet } from "../../model";
import type { TyreStint } from "./types";

/** A corner's wear falling by this much (0..1) means fresh rubber went on. */
export const NEW_SET_WEAR_DROP = 0.01;
/** Every corner at or below this wear (0..1) counts as a just-fitted set. */
export const FRESH_SET_WEAR = 0.005;

/** One tick of the player's car. */
export interface TyreStintInput {
  lapsCompleted: number | null;
  tyres: TyreSet | null;
}

export function tyreStintInput(state: SimState): TyreStintInput {
  const car = state.cars.find((c) => c.carIdx === state.playerCarIdx);
  return { lapsCompleted: car?.lapsCompleted ?? null, tyres: state.player.tyres };
}

const corners = (t: TyreSet): (number | null)[] => [t.fl.wear, t.fr.wear, t.rl.wear, t.rr.wear];

/**
 * Counts the laps on the player's tyres. No sim reports when a set went on, so a new set is
 * recognised by its rubber: a corner's wear falling (wear only grows on a set) or a different
 * compound name. A set seen first on lap 0 or with unworn rubber was just fitted; a set seen
 * first part-worn mid-session has an unknown age until the next change.
 */
export class TyreStintTracker {
  private fittedAtLap: number | null = null;
  private lastWear: (number | null)[] | null = null;
  private lastCompounds: string | null = null;

  reset(): void {
    this.fittedAtLap = null;
    this.lastWear = null;
    this.lastCompounds = null;
  }

  next(input: TyreStintInput): TyreStint | null {
    const { tyres } = input;
    const laps = input.lapsCompleted === null ? null : Math.max(0, input.lapsCompleted);
    if (tyres === null || laps === null) return null;
    const wear = corners(tyres);
    const compounds = `${tyres.frontCompound ?? ""}/${tyres.rearCompound ?? ""}`;
    if (this.lastWear === null) {
      const fresh = wear.every((w) => w === null || w <= FRESH_SET_WEAR);
      this.fittedAtLap = fresh || laps === 0 ? laps : null;
    } else if (this.isNewSet(wear, compounds)) {
      this.fittedAtLap = laps;
    }
    this.lastWear = wear;
    this.lastCompounds = compounds;
    // A lap counter that went backwards (a restart) starts the count again.
    if (this.fittedAtLap !== null && laps < this.fittedAtLap) this.fittedAtLap = laps;
    return { lapsOnSet: this.fittedAtLap === null ? null : laps - this.fittedAtLap };
  }

  private isNewSet(wear: (number | null)[], compounds: string): boolean {
    if (compounds !== this.lastCompounds) return true;
    return wear.some((w, i) => {
      const before = this.lastWear?.[i] ?? null;
      return w !== null && before !== null && before - w >= NEW_SET_WEAR_DROP;
    });
  }
}
