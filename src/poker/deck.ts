import { fullDeck, type Card } from "./cards";

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle(deck: Card[] = fullDeck()): Card[] {
  const cards = deck.slice();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

/** Draw `n` cards from the front of the deck. Mutates the deck. */
export function draw(deck: Card[], n: number): Card[] {
  if (n > deck.length) {
    throw new Error(`Need ${n} cards but only ${deck.length} remain`);
  }
  return deck.splice(0, n);
}
