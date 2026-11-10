// Test support only.
import type { TelemetryFrame, TyreCorner, TyreSet } from "@overlay/sim-core/types";
import { fixtureFrame } from "../shared/fixtures";

/** [inner, middle, outer] surface temps; the layer under the tread runs 3 degrees cooler. */
export function tyreCorner(
  wear: number | null,
  [inner, middle, outer]: readonly [number, number, number],
  pressureKpa: number | null = 172,
  brakeTempC: number | null = 490,
): TyreCorner {
  return {
    temps: { inner, middle, outer },
    innerLayerTemps: { inner: inner - 3, middle: middle - 3, outer: outer - 3 },
    carcassTempC: middle - 5,
    brakeTempC,
    pressureKpa,
    wear,
  };
}

/** One compound on all four tyres, front and rear. */
export function fitSet(t: TyreSet, compound: string | null): TyreSet {
  for (const c of [t.fl, t.fr, t.rl, t.rr]) c.compound = compound;
  t.frontCompound = compound;
  t.rearCompound = compound;
  return t;
}

/** The design's set, with surface temps 3 degrees above the board's (which shows the layer). */
export function designTyres(): TyreSet {
  return fitSet(
    {
      fl: tyreCorner(0.07, [97, 94, 90], 172, 490),
      fr: tyreCorner(0.09, [99, 96, 92], 174, 510),
      rl: tyreCorner(0.05, [93, 91, 88], 169, 420),
      rr: tyreCorner(0.06, [94, 92, 89], 170, 430),
    },
    "Medium",
  );
}

export function tyresFrame(
  tyres: TyreSet | null = designTyres(),
  lapsOnSet: number | null = 15,
): TelemetryFrame {
  const f = fixtureFrame({ sim: "lmu", cars: [{ carIdx: 0 }], playerCarIdx: 0, player: { tyres } });
  f.derived.tyreStint = lapsOnSet === null ? null : { lapsOnSet };
  return f;
}
