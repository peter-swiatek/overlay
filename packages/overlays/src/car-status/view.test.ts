import { describe, expect, it } from "vitest";
import { damage } from "../vehicle-damage/testing";
import { carFrame, restDamage } from "./testing";
import {
  carStatusView,
  damagePctText,
  fractionSeverity,
  SAMPLE_CAR_STATUS_VIEW,
  tyreTemp,
} from "./view";

const WINDOW = { coldBelowC: 70, hotAboveC: 95, overheatAboveC: 105 };

describe("carStatusView", () => {
  it("is null without a live frame or anything to show", () => {
    expect(carStatusView(null)).toBeNull();
    const waiting = carFrame();
    waiting.status = "waiting";
    expect(carStatusView(waiting)).toBeNull();
    const empty = carFrame({ tyres: false, damage: null, waterTempC: null, oilTempC: null });
    expect(carStatusView(empty)).toBeNull();
  });

  it("gathers tyres, dents, engine temperatures and the repair screen's damage", () => {
    const v = carStatusView(
      carFrame({ damage: restDamage([1], 0.0533, { fl: 0.057, fr: 0, rl: 0.138, rr: 0 }) }),
    );
    expect(v?.tyres?.fr.pressureKpa).toBe(174);
    expect(v?.tyres?.fr.brakeC).toBe(510);
    expect(v?.damage?.zones.front).toBe("minor");
    expect(v?.aero).toBe(0.0533);
    expect(v?.suspension).toEqual({ fl: 0.057, fr: 0, rl: 0.138, rr: 0 });
    expect(v?.waterC).toBe(86);
    expect(v?.oilC).toBe(101);
  });

  it("leaves out what the sim did not give", () => {
    // Shared memory only: the game's REST API did not answer.
    const v = carStatusView(carFrame({ damage: damage(), oilTempC: null }));
    expect(v?.aero).toBeNull();
    expect(v?.suspension).toBeNull();
    expect(v?.oilC).toBeNull();
    expect(carStatusView(carFrame({ waterTempC: Number.NaN }))?.waterC).toBeNull();
    expect(carStatusView(carFrame({ damage: null }))?.damage).toBeNull();
  });
});

describe("helpers", () => {
  it("grades a damage fraction: none, minor, heavy from 10 %", () => {
    expect(fractionSeverity(null)).toBeNull();
    expect(fractionSeverity(0)).toBe("ok");
    expect(fractionSeverity(0.0004)).toBe("ok");
    expect(fractionSeverity(0.057)).toBe("minor");
    expect(fractionSeverity(0.1)).toBe("heavy");
    expect(fractionSeverity(0.138)).toBe("heavy");
  });

  it("averages the tyre across its tread and bands it like the Tyres overlay", () => {
    const fl = SAMPLE_CAR_STATUS_VIEW.tyres!.fl;
    expect(tyreTemp(fl, true, WINDOW)).toEqual({ c: 86, band: "ok" });
    const hot = { ...fl, surface: { inner: 99, middle: 96, outer: 92 } };
    expect(tyreTemp(hot, false, WINDOW)).toEqual({ c: (99 + 96 + 92) / 3, band: "hot" });
    // Under the tread falls back to the surface when the sim gives no layer.
    expect(tyreTemp({ ...hot, innerLayer: null }, true, WINDOW).band).toBe("hot");
    const none = { ...fl, innerLayer: null, surface: { inner: null, middle: null, outer: null } };
    expect(tyreTemp(none, true, WINDOW)).toEqual({ c: null, band: "unknown" });
  });

  it("writes damage with one decimal", () => {
    expect(damagePctText(0)).toBe("0.0%");
    expect(damagePctText(0.03)).toBe("3.0%");
    expect(damagePctText(0.1377)).toBe("13.8%");
  });
});
