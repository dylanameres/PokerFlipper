import { cardRank, cardSuit, type Card } from "./cards";

export interface PreflopAdvice {
  label: string;
  tier: "premium" | "strong" | "playable" | "marginal" | "fold";
  advice: string;
}

/**
 * A lightweight, opinionated preflop starting-hand classifier for heads-up /
 * early position Texas Hold'em. It is meant to teach, not to be GTO-perfect.
 */
export function classifyStartingHand(hole: Card[]): PreflopAdvice | null {
  if (hole.length !== 2) return null;

  const [a, b] = hole;
  const r1 = cardRank(a);
  const r2 = cardRank(b);
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const paired = r1 === r2;
  const suited = cardSuit(a) === cardSuit(b);
  const gap = hi - lo;

  if (paired) {
    if (hi >= 10) {
      return {
        label: "Big pair",
        tier: "premium",
        advice: "A premium pair. Raise for value and build the pot.",
      };
    }
    if (hi >= 7) {
      return {
        label: "Medium pair",
        tier: "strong",
        advice: "Strong pair. Raise, but respect heavy action on big boards.",
      };
    }
    return {
      label: "Small pair",
      tier: "playable",
      advice: "Play to flop a set. Call in position, fold to big raises.",
    };
  }

  // Big two broadway-ish cards.
  if (hi === 14 && lo >= 12) {
    return {
      label: "Big ace",
      tier: "premium",
      advice: "AK/AQ play strongly. Raise and continue on most flops.",
    };
  }
  if (hi >= 12 && lo >= 10) {
    return {
      label: "Broadway cards",
      tier: "strong",
      advice: suited
        ? "Two big suited cards. Raise and enjoy the flush upside."
        : "Two big cards. Raise, but be ready to fold weak pairs.",
    };
  }

  // Suited connectors / one-gappers.
  if (suited && gap <= 2 && lo >= 6) {
    return {
      label: "Suited connector",
      tier: "playable",
      advice: "Great for set/straight/flush draws in position. Play speculatively.",
    };
  }

  if (hi === 14) {
    return {
      label: suited ? "Suited ace" : "Weak ace",
      tier: suited ? "playable" : "marginal",
      advice: suited
        ? "Suited aces make nut flushes. Playable in position."
        : "Offsuit weak ace is easily dominated. Play cautiously.",
    };
  }

  if (hi >= 11) {
    return {
      label: "One big card",
      tier: "marginal",
      advice: "Marginal. Playable in position, fold to strong pressure.",
    };
  }

  return {
    label: "Trash",
    tier: "fold",
    advice: "Low, disconnected cards. Fold in most spots.",
  };
}
