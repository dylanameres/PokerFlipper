export const SUIT_GLYPH: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

export const SUIT_NAMES: Record<string, string> = {
  s: "Spades",
  h: "Hearts",
  d: "Diamonds",
  c: "Clubs",
};

export function suitColorClass(suit: string, fourColorDeck: boolean): string {
  if (fourColorDeck) {
    if (suit === "s") return "card--spade";
    if (suit === "h") return "card--heart";
    if (suit === "d") return "card--diamond";
    return "card--club";
  }
  return suit === "h" || suit === "d" ? "card--red" : "card--black";
}
