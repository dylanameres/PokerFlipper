import type { WireCard } from "../../shared/protocol";

export function fullDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Cryptographically shuffled deck (runs on Cloudflare Workers). */
export function secureShuffle(deck: number[]): number[] {
  const cards = deck.slice();
  const rand = new Uint32Array(1);
  for (let i = cards.length - 1; i > 0; i--) {
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

export function emptyBoard(): WireCard[] {
  return [null, null, null, null, null];
}

export function emptyHoles(n: number): WireCard[] {
  return Array.from({ length: n }, () => null);
}

export function assignHole(seatHoles: WireCard[], slot: number, card: number) {
  seatHoles[slot] = card;
}
