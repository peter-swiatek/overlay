/** What the ordering functions need to know about one car. */
export interface OrderCar {
  carIdx: number;
  /** Official position (S/F based). */
  position: number | null;
  /** lapsCompleted + lapDistPct; null when unknown. */
  progress: number | null;
  bestLapS: number | null;
  /** 1.. for cars that took the chequered flag, in finishing order; 0 = still racing. */
  finishRank: number;
}

function cmpNullsLast(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

/** Cars with no usable ordering data come last in `officialOrder`. */
export function hasOfficialOrder(car: OrderCar): boolean {
  return car.position !== null || car.bestLapS !== null;
}

function cmpRace(a: OrderCar, b: OrderCar): number {
  // Finished cars keep the order in which they finished, ahead of everyone still racing.
  if (a.finishRank !== b.finishRank) {
    if (a.finishRank === 0) return 1;
    if (b.finishRank === 0) return -1;
    return a.finishRank - b.finishRank;
  }
  if (a.progress !== null && b.progress !== null && a.progress !== b.progress) {
    return b.progress - a.progress;
  }
  if ((a.progress === null) !== (b.progress === null)) return a.progress === null ? 1 : -1;
  return cmpNullsLast(a.position, b.position) || a.carIdx - b.carIdx;
}

function cmpOfficial(a: OrderCar, b: OrderCar): number {
  if (a.position !== null || b.position !== null) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    if (a.position !== b.position) return a.position - b.position;
  }
  return cmpNullsLast(a.bestLapS, b.bestLapS) || a.carIdx - b.carIdx;
}

/** Indices into `cars`, leader first. Race order is by distance covered. */
export function raceOrder(cars: readonly OrderCar[]): number[] {
  return sortedIndices(cars, cmpRace);
}

/**
 * Practice, qualifying and the like: official position, falling back to best lap when positions
 * are missing.
 */
export function officialOrder(cars: readonly OrderCar[]): number[] {
  return sortedIndices(cars, cmpOfficial);
}

function sortedIndices(cars: readonly OrderCar[], cmp: (a: OrderCar, b: OrderCar) => number) {
  const idx = cars.map((_, i) => i);
  return idx.sort((i, j) => cmp(cars[i] as OrderCar, cars[j] as OrderCar));
}
