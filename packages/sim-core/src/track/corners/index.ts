import virFull from "./iracing_virginia-international-raceway_full-course.json";
import sarthe from "./lmu_circuit-de-la-sarthe.json";
import { parseCornerList, type CornerList } from "./schema";

export * from "./schema";

const LISTS: readonly CornerList[] = [virFull, sarthe].map(parseCornerList);

/** The corner list for a track key (see `trackKeyOf`), or null when we have none. */
export function cornersFor(trackKey: string | null): CornerList | null {
  return trackKey === null ? null : (LISTS.find((l) => l.trackKey === trackKey) ?? null);
}
