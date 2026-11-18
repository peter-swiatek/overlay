import { describe, expect, it } from "vitest";
import { Deriver } from "./derive";
import { MockSource } from "./mock";

describe("Deriver tyre stint", () => {
  it("counts the mock's laps on its one set and forgets them on a reset", () => {
    const mock = new MockSource();
    const deriver = new Deriver();
    let state = mock.step(0.1);
    expect(deriver.next(state).tyreStint).toEqual({ lapsOnSet: 0 });
    for (let i = 0; i < 400; i++) state = mock.step(1);
    const laps = state.cars[0]?.lapsCompleted ?? 0;
    expect(laps).toBeGreaterThanOrEqual(3);
    expect(deriver.next(state).tyreStint).toEqual({ lapsOnSet: laps });
    deriver.reset();
    // Seen again mid-session on a used set: the age is unknown.
    expect(deriver.next(state).tyreStint).toEqual({ lapsOnSet: null });
  });

  it("is null for a sim without tyre data", () => {
    const state = new MockSource().step(0.1);
    state.player.tyres = null;
    expect(new Deriver().next(state).tyreStint).toBeNull();
  });
});
