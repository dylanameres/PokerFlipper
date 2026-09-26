/**
 * PokerFlipper engine — Texas Hold'em / Omaha table + equity tools.
 *
 * Cards are strings: rank (2-9, T, J, Q, K, A) + suit (s, h, d, c).
 * Example: "As" = Ace of spades, "Td" = Ten of diamonds.
 */
export {
  parseCard,
  cardToString,
  fullDeck,
  makeCard,
  RANKS,
  SUITS,
  type Card,
  type Rank,
  type Suit,
} from "./cards";
export {
  evaluateBest,
  evaluate5,
  HandCategory,
  HAND_CATEGORY_NAMES,
} from "./evaluator";
export { evaluateOmaha } from "./omaha";
export {
  simulateHand,
  type SimulateHandOptions,
  type SimulateHandResult,
} from "./simulate";
export { liveEquity, findOuts, scoreHand } from "./equity";
export { shuffle, draw } from "./deck";
export {
  type GameType,
  HOLE_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  gameLabel,
} from "./game";
