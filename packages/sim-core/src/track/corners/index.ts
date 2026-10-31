import virFull from "./iracing_virginia-international-raceway_full-course.json";
import sarthe from "./lmu_circuit-de-la-sarthe_13620m.json";
import { sameTrackKey } from "../track-key";
import { parseCornerList, type CornerList } from "./schema";

export * from "./schema";

const LISTS: readonly CornerList[] = [virFull, sarthe].map(parseCornerList);

/**
 * The corner list for a track key (see `trackKeyOf`), or null when we have none. A key that
 * carries the rounded track length matches a list within 20 m of that length.
 */
export function cornersFor(trackKey: string | null): CornerList | null {
  return trackKey === null ? null : (LISTS.find((l) => sameTrackKey(l.trackKey, trackKey)) ?? null);
}
