import { describe, expect, it } from "vitest";
import { BODY_LEFT, SEGMENTS, VIEW_H, VIEW_W, WHEELS } from "./shape";

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function pathBox(d: string): Box {
  const nums = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const rectBox = (r: { x: number; y: number; width: number; height: number }): Box => ({
  x0: r.x,
  y0: r.y,
  x1: r.x + r.width,
  y1: r.y + r.height,
});

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("car shape", () => {
  it("has a nose bar, four corner arcs, two side panels and two bars at the tail", () => {
    expect(SEGMENTS.map((s) => s.zone)).toEqual([
      "front",
      "frontLeft",
      "frontRight",
      "left",
      "right",
      "rearLeft",
      "rearRight",
      "rear",
      "rear",
    ]);
    const [bumper, diffuser] = SEGMENTS.filter((s) => s.zone === "rear").map((s) => pathBox(s.d));
    // The diffuser sits below the bumper, wider and thinner.
    expect(diffuser!.y0).toBeGreaterThan(bumper!.y1);
    expect(diffuser!.x1 - diffuser!.x0).toBeGreaterThan(bumper!.x1 - bumper!.x0);
    expect(diffuser!.y1 - diffuser!.y0).toBeLessThan(bumper!.y1 - bumper!.y0);
    for (const s of SEGMENTS) {
      const b = pathBox(s.d);
      expect(b.x0).toBeGreaterThanOrEqual(BODY_LEFT - 0.5);
      expect(b.x1).toBeLessThanOrEqual(VIEW_W - BODY_LEFT + 0.5);
      expect(b.y1).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it("puts each wheel's chevron, brake and tyre apart, outward in that order", () => {
    for (const [id, w] of Object.entries(WHEELS)) {
      const left = id.endsWith("l");
      const tyre = rectBox(w.tyre);
      const brake = rectBox(w.brake);
      const chev = pathBox(w.chevron);
      // Outward means further from the centre line: chevron, then brake, then tyre.
      const out = (b: Box) => (left ? -b.x0 : b.x1);
      expect(out(brake)).toBeGreaterThan(out(chev));
      expect(out(tyre)).toBeGreaterThan(out(brake));
      // Separate, with gaps: none touches another or any body segment.
      expect(overlaps(tyre, brake)).toBe(false);
      expect(overlaps(brake, chev)).toBe(false);
      for (const s of SEGMENTS) {
        const seg = pathBox(s.d);
        expect(overlaps(seg, chev), `${id} chevron and ${s.zone}`).toBe(false);
        expect(overlaps(seg, brake), `${id} brake and ${s.zone}`).toBe(false);
        expect(overlaps(seg, tyre), `${id} tyre and ${s.zone}`).toBe(false);
      }
      // The tyre is outside the body; the brake sits against the tyre, inside its length.
      expect(left ? tyre.x1 : VIEW_W - tyre.x0).toBeLessThan(BODY_LEFT);
      expect(brake.y0).toBeGreaterThan(tyre.y0);
      expect(brake.y1).toBeLessThan(tyre.y1);
    }
  });

  it("puts the front wheels beside the front of the body and the rear ones beside the rear", () => {
    expect(WHEELS.fl.tyre.y).toBe(WHEELS.fr.tyre.y);
    expect(WHEELS.rl.tyre.y).toBe(WHEELS.rr.tyre.y);
    expect(WHEELS.fl.tyre.y + WHEELS.fl.tyre.height).toBeLessThan(VIEW_H / 2);
    expect(WHEELS.rl.tyre.y).toBeGreaterThan(VIEW_H / 2);
  });
});
