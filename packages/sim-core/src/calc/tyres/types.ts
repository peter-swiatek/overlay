/** The set of tyres on the player's car. */
export interface TyreStint {
  /**
   * Laps completed since the set was fitted; null when the fitting was not seen (the overlay
   * started mid-stint on a used set).
   */
  lapsOnSet: number | null;
}
