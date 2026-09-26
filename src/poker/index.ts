/**
 * PokerFlipper engine — a tiny Texas Hold'em equity simulator.
 *
 * Cards are strings: rank (2-9, T, J, Q, K, A) + suit (s, h, d, c).
 * Example: "As" = Ace of spades, "Td" = Ten of diamonds.
 */
export { parseCard, cardToString, type Card } from "./cards";
export {
  evaluateBest,
  evaluate5,
  HandCategory,
  HAND_CATEGORY_NAMES,
} from "./evaluator";
export {
  simulateHand,
  type SimulateHandOptions,
  type SimulateHandResult,
} from "./simulate";
