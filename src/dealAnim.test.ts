import { describe, expect, it } from "vitest";
import {
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
});
