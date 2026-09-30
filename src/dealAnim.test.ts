import { describe, expect, it } from "vitest";
import {
  isDealKeyAnimating,
  markDealKeysAnimating,
  newDealKeys,
  rememberDealKeys,
  resetDealAnimationState,
} from "./dealAnim";

describe("dealAnim redeal keys", () => {
  it("forgets prior slot keys so Redeal fly-ins run again", () => {
    const holes = ["h-0-0", "h-0-1", "h-1-0", "h-1-1"];
    rememberDealKeys(holes);
    expect(newDealKeys(holes)).toEqual([]);
    resetDealAnimationState();
    expect(newDealKeys(holes)).toEqual(holes);
  });

  it("keeps in-flight keys pending after they are remembered", () => {
    resetDealAnimationState();
    markDealKeysAnimating(["h-0-0", "h-0-1"]);
    rememberDealKeys(["h-0-0", "h-0-1"]);
    // No longer "new", but still animating so re-renders can keep them hidden.
    expect(newDealKeys(["h-0-0", "h-0-1"])).toEqual([]);
    expect(isDealKeyAnimating("h-0-0")).toBe(true);
    expect(isDealKeyAnimating("h-0-1")).toBe(true);
    resetDealAnimationState();
    expect(isDealKeyAnimating("h-0-0")).toBe(false);
  });
});
