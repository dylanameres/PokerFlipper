export const RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
] as const;

export const SUITS = ["s", "h", "d", "c"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

/**
 * A card is encoded as an integer 0..51.
 * rank index = card >> 2 (0 = "2" ... 12 = "A")
 * suit index = card & 3
 */
export type Card = number;

export function makeCard(rank: Rank, suit: Suit): Card {
  return (RANKS.indexOf(rank) << 2) | SUITS.indexOf(suit);
}

export function cardRank(card: Card): number {
  // 2..14 (14 = Ace) for readability in the evaluator.
  return (card >> 2) + 2;
}

export function cardSuit(card: Card): number {
  return card & 3;
}

export function cardToString(card: Card): string {
  return `${RANKS[card >> 2]}${SUITS[card & 3]}`;
}

export function parseCard(str: string): Card {
  const rank = str[0].toUpperCase() as Rank;
  const suit = str[1].toLowerCase() as Suit;
  const r = RANKS.indexOf(rank);
  const s = SUITS.indexOf(suit);
  if (r < 0 || s < 0) {
    throw new Error(`Invalid card string: ${str}`);
  }
  return (r << 2) | s;
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let i = 0; i < 52; i++) {
    deck.push(i);
  }
  return deck;
}
