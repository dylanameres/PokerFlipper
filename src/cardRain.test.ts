import { describe, expect, it } from "vitest";
import { layoutDrops } from "./cardRain";

describe("layoutDrops", () => {
  it("covers the full width with one drop per column", () => {
    const drops = layoutDrops(20);
    expect(drops).toHaveLength(20);
    drops.forEach((d, i) => {
      expect(d.x).toBeGreaterThanOrEqual((i / 20) * 100);
      expect(d.x).toBeLessThan(((i + 1) / 20) * 100);
    });
  });

  it("starts every drop mid-fall so the screen is full on load", () => {
    for (const d of layoutDrops(50)) {
      expect(d.delayS).toBeLessThanOrEqual(0);
      expect(-d.delayS).toBeLessThanOrEqual(d.durationS);
      expect(d.durationS).toBeGreaterThan(10);
    }
  });

  it("makes nearer drops fall faster", () => {
    let t = 0;
    const steady = () => 0.5;
    const near = layoutDrops(1, () => (t++ === 0 ? 1 : 0.5))[0];
    t = 0;
    const far = layoutDrops(1, () => (t++ === 0 ? 0 : 0.5))[0];
    expect(near.durationS).toBeLessThan(far.durationS);
    expect(layoutDrops(1, steady)[0].depth).toBe(0.5);
  });
});
