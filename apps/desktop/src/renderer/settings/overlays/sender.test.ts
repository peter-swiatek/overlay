import type { OverlayInstanceSettings, OverlaySettingsPatch } from "@overlay/overlays/contract";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import { describe, expect, it } from "vitest";
import { createDebouncer, type TimerApi } from "./debounce";
import { createOverlaySender, type AllSettings } from "./sender";
import { testTableManifest } from "./test-manifest";

function setup() {
  const timers = new Map<number, () => void>();
  let n = 0;
  const timer: TimerApi<number> = {
    set: (fn) => {
      timers.set(++n, fn);
      return n;
    },
    clear: (h) => void timers.delete(h),
  };
  const sent: OverlaySettingsPatch[] = [];
  let shown: AllSettings = {};
  const sender = createOverlaySender({
    manifests: [testTableManifest],
    debouncer: createDebouncer(timer),
    update: async (_id, patch) => void sent.push(patch),
    publish: (next) => (shown = next),
  });
  const id = testTableManifest.id;
  const base = defaultInstanceSettings(testTableManifest);
  sender.load({ [id]: base });
  return {
    sender,
    id,
    base,
    sent,
    fields: () => shown[id]!.common.fields,
    fire: () => [...timers.values()].forEach((f) => f()),
    shown: () => shown,
  };
}

describe("overlay sender", () => {
  it("a width slider does not revert a reorder made within the debounce window", () => {
    const { sender, id, base, sent, fields, fire } = setup();
    const first = base.common.fields[0]!;
    const widened = base.common.fields.map((f) => (f.id === first.id ? { ...f, widthPct: 40 } : f));
    sender.send(id, { common: { fields: widened } }, "fields-width");
    const reordered = [...fields()].reverse();
    sender.send(id, { common: { fields: reordered } });
    fire();
    const order = reordered.map((f) => f.id);
    expect(fields().map((f) => f.id)).toEqual(order);
    // Everything that went out ends in the new order, with the width kept.
    expect(sent.at(-1)!.common!.fields!.map((f) => f.id)).toEqual(order);
    expect(sent.at(-1)!.common!.fields!.find((f) => f.id === first.id)!.widthPct).toBe(40);
  });

  it("rebuilds a debounced column list from the latest state when the timer fires", () => {
    const { sender, id, base, sent, fields, fire } = setup();
    const widened = base.common.fields.map((f, i) => (i === 0 ? { ...f, widthPct: 33 } : f));
    sender.send(id, { common: { fields: widened } }, "fields-width");
    fire();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.common!.fields![0]!.widthPct).toBe(33);
    expect(fields()[0]!.widthPct).toBe(33);
  });

  it("keeps an unsent slider value when an echo of an earlier send arrives", () => {
    const { sender, id, base, shown } = setup();
    sender.send(id, { common: { opacityPct: 55 } }, "opacityPct");
    const echo: OverlayInstanceSettings = {
      ...base,
      common: { ...base.common, opacityPct: 80 },
    };
    sender.incoming(id, echo);
    expect(shown()[id]!.common.opacityPct).toBe(55);
  });

  it("stops re-applying a patch once main has accepted it", async () => {
    const { sender, id, base, shown, fire } = setup();
    sender.send(id, { common: { opacityPct: 55 } }, "opacityPct");
    fire();
    await Promise.resolve();
    await Promise.resolve();
    sender.incoming(id, { ...base, common: { ...base.common, opacityPct: 80 } });
    expect(shown()[id]!.common.opacityPct).toBe(80);
  });

  it("forgets a removed instance and drops its waiting patches", () => {
    const t = setup();
    const id2 = `${t.id}:2`;
    t.sender.incoming(id2, t.base);
    t.sender.send(id2, { common: { opacityPct: 40 } }, "opacityPct");
    expect(t.shown()[id2]?.common.opacityPct).toBe(40);
    t.sender.removed(id2);
    expect(t.shown()).not.toHaveProperty(id2);
    t.fire();
    expect(t.sent).toEqual([]);
  });

  it("applies patches to an added instance with the overlay's manifest", () => {
    const t = setup();
    const id2 = `${t.id}:2`;
    t.sender.incoming(id2, t.base);
    t.sender.send(id2, { name: "Second" });
    expect(t.shown()[id2]?.name).toBe("Second");
    expect(t.shown()[t.id]).not.toHaveProperty("name");
    expect(t.sent).toEqual([{ name: "Second" }]);
  });
});
