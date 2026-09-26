import { useState } from "react";
import {
  RANKS,
  SUITS,
  type Card,
  cardSuit,
  makeCard,
} from "../poker/cards";

const SUIT_GLYPH: Record<string, string> = {
  s: "\u2660", // spade
  h: "\u2665", // heart
  d: "\u2666", // diamond
  c: "\u2663", // club
};

const SUIT_NAME: Record<string, string> = {
  s: "Spades",
  h: "Hearts",
  d: "Diamonds",
  c: "Clubs",
};

function isRed(card: Card): boolean {
  const s = cardSuit(card);
  return s === 1 || s === 2; // hearts or diamonds
}

interface SlotProps {
  card: Card | null;
  onClick: () => void;
}

function Slot({ card, onClick }: SlotProps) {
  if (card === null) {
    return (
      <button className="card-slot" onClick={onClick} aria-label="Empty card slot">
        +
      </button>
    );
  }
  const rank = RANKS[card >> 2];
  const suit = SUITS[card & 3];
  return (
    <button
      className={`card-slot filled ${isRed(card) ? "red" : "black"}`}
      onClick={onClick}
      aria-label={`${rank} of ${SUIT_NAME[suit]}`}
    >
      <span className="rank">{rank}</span>
      <span className="suit">{SUIT_GLYPH[suit]}</span>
    </button>
  );
}

interface CardPickerProps {
  /** Currently selected cards (may contain nulls for empty slots). */
  cards: (Card | null)[];
  /** Cards used elsewhere and therefore unavailable. */
  usedCards: Set<Card>;
  onChange: (cards: (Card | null)[]) => void;
  title: string;
}

export function CardPicker({
  cards,
  usedCards,
  onChange,
  title,
}: CardPickerProps) {
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  const setCard = (index: number, card: Card | null) => {
    const next = cards.slice();
    next[index] = card;
    onChange(next);
    setOpenSlot(null);
  };

  const ownCards = new Set(cards.filter((c): c is Card => c !== null));

  return (
    <>
      <div className="slot-row">
        {cards.map((card, i) => (
          <Slot key={i} card={card} onClick={() => setOpenSlot(i)} />
        ))}
      </div>

      {openSlot !== null && (
        <div
          className="picker-backdrop"
          onClick={() => setOpenSlot(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <h3>
              {title}: pick a card
            </h3>
            {SUITS.map((suit) => (
              <div key={suit}>
                <div className="suit-label">
                  {SUIT_GLYPH[suit]} {SUIT_NAME[suit]}
                </div>
                <div className="picker-grid">
                  {RANKS.map((rank) => {
                    const card = makeCard(rank, suit);
                    const disabled =
                      (usedCards.has(card) && !ownCards.has(card)) ||
                      cards[openSlot] === card;
                    const takenByOther =
                      ownCards.has(card) && cards[openSlot] !== card;
                    return (
                      <button
                        key={rank}
                        className={`mini-card ${
                          suit === "h" || suit === "d" ? "red" : ""
                        }`}
                        disabled={disabled || takenByOther}
                        onClick={() => setCard(openSlot, card)}
                      >
                        <span>{rank}</span>
                        <span>{SUIT_GLYPH[suit]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button
                className="ghost"
                onClick={() => setCard(openSlot, null)}
              >
                Clear slot
              </button>
              <button className="ghost" onClick={() => setOpenSlot(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
