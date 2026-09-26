import {
  cardToString,
  draw,
  findOuts,
  fullDeck,
  gameLabel,
  HOLE_COUNT,
  liveEquity,
  makeCard,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RANKS,
  shuffle,
  SUITS,
  type Card,
  type GameType,
} from "./poker";

type Screen = "setup" | "table";
type Street = "predeal" | "holes" | "flop" | "turn" | "river";

interface AppState {
  screen: Screen;
  gameType: GameType;
  playerCount: number;
  deck: Card[];
  hands: (Card | null)[][];
  board: (Card | null)[];
  street: Street;
  equities: number[] | null;
  /** Seat index whose outs panel is open, or null. */
  outsSeat: number | null;
  /** Hole-card picker target, or null when closed. */
  picking: { player: number; slot: number } | null;
  settingsOpen: boolean;
  fourColorDeck: boolean;
}

const SETTINGS_KEY = "pokerflipper-settings";

function loadSettings(): { fourColorDeck: boolean } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { fourColorDeck: false };
    const parsed = JSON.parse(raw) as { fourColorDeck?: boolean };
    return { fourColorDeck: Boolean(parsed.fourColorDeck) };
  } catch {
    return { fourColorDeck: false };
  }
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ fourColorDeck: state.fourColorDeck }),
  );
}

const root = document.getElementById("app")!;
const saved = loadSettings();

const state: AppState = {
  screen: "setup",
  gameType: "holdem",
  playerCount: 2,
  deck: [],
  hands: [],
  board: emptyBoard(),
  street: "predeal",
  equities: null,
  outsSeat: null,
  picking: null,
  settingsOpen: false,
  fourColorDeck: saved.fourColorDeck,
};

function emptyBoard(): (Card | null)[] {
  return [null, null, null, null, null];
}

function emptyHands(players: number, holes: number): (Card | null)[][] {
  return Array.from({ length: players }, () =>
    Array.from({ length: holes }, () => null),
  );
}

function filledHands(): Card[][] {
  return state.hands.map((h) => h.filter((c): c is Card => c !== null));
}

function filledBoard(): Card[] {
  return state.board.filter((c): c is Card => c !== null);
}

function usedCards(except?: { player: number; slot: number }): Set<Card> {
  const used = new Set<Card>();
  for (let p = 0; p < state.hands.length; p++) {
    for (let s = 0; s < state.hands[p].length; s++) {
      if (except && except.player === p && except.slot === s) continue;
      const c = state.hands[p][s];
      if (c !== null) used.add(c);
    }
  }
  for (const c of state.board) {
    if (c !== null) used.add(c);
  }
  return used;
}

/** Rebuild the draw pile from cards not currently on the table. */
function rebuildDeck() {
  const used = usedCards();
  state.deck = shuffle(fullDeck().filter((c) => !used.has(c)));
}

function resetTable() {
  const holes = HOLE_COUNT[state.gameType];
  state.hands = emptyHands(state.playerCount, holes);
  state.board = emptyBoard();
  state.street = "predeal";
  state.equities = null;
  state.outsSeat = null;
  state.picking = null;
  rebuildDeck();
}

function refreshEquity() {
  if (state.street === "predeal") {
    state.equities = null;
    return;
  }
  // Equity needs every hole card filled.
  if (state.hands.some((h) => h.some((c) => c === null))) {
    state.equities = null;
    return;
  }
  state.equities = liveEquity(state.gameType, filledHands(), filledBoard());
}

function startTable() {
  resetTable();
  state.screen = "table";
  render();
}

function dealHoles() {
  if (state.street !== "predeal") {
    // New round — clear everything, including prior picks.
    resetTable();
  } else {
    // Keep any pre-selected hole cards; clear board just in case.
    state.board = emptyBoard();
    state.outsSeat = null;
    state.picking = null;
  }

  rebuildDeck();
  const holes = HOLE_COUNT[state.gameType];
  for (let h = 0; h < holes; h++) {
    for (let p = 0; p < state.playerCount; p++) {
      if (state.hands[p][h] === null) {
        state.hands[p][h] = draw(state.deck, 1)[0];
      }
    }
  }
  state.street = "holes";
  refreshEquity();
  render();
}

function openPicker(player: number, slot: number) {
  state.picking = { player, slot };
  render();
}

function closePicker() {
  state.picking = null;
  render();
}

function assignHoleCard(card: Card | null) {
  if (!state.picking) return;
  const { player, slot } = state.picking;
  state.hands[player][slot] = card;
  state.picking = null;
  rebuildDeck();
  if (state.street !== "predeal") {
    refreshEquity();
    syncOutsSeat();
  }
  render();
}

function holesComplete(): boolean {
  return state.hands.every((h) => h.every((c) => c !== null));
}

function dealFlop() {
  if (state.street !== "holes" || !holesComplete()) return;
  draw(state.deck, 1);
  const flop = draw(state.deck, 3);
  state.board[0] = flop[0];
  state.board[1] = flop[1];
  state.board[2] = flop[2];
  state.street = "flop";
  refreshEquity();
  syncOutsSeat();
  render();
}

function dealTurn() {
  if (state.street !== "flop") return;
  draw(state.deck, 1);
  state.board[3] = draw(state.deck, 1)[0];
  state.street = "turn";
  refreshEquity();
  syncOutsSeat();
  render();
}

function dealRiver() {
  if (state.street !== "turn") return;
  draw(state.deck, 1);
  state.board[4] = draw(state.deck, 1)[0];
  state.street = "river";
  state.outsSeat = null; // outs only apply before the river
  refreshEquity();
  render();
}

function backToSetup() {
  state.screen = "setup";
  state.outsSeat = null;
  state.picking = null;
  render();
}

/* ---------- rendering ---------- */

const SUIT_GLYPH: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

/** Suit color class: classic red/black, or 4-color (s black, h red, d blue, c green). */
function suitColorClass(suit: string): string {
  if (state.fourColorDeck) {
    if (suit === "s") return "card--spade";
    if (suit === "h") return "card--heart";
    if (suit === "d") return "card--diamond";
    return "card--club";
  }
  return suit === "h" || suit === "d" ? "card--red" : "card--black";
}

function renderGearButton(): string {
  return `<button type="button" class="btn btn--icon" id="btn-settings" aria-label="Settings" title="Settings">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.983 2a1 1 0 0 1 .95.68l.37 1.12a7.1 7.1 0 0 1 1.35.78l1.1-.55a1 1 0 0 1 1.26.34l1.02 1.76a1 1 0 0 1-.2 1.28l-.9.8c.1.45.15.91.15 1.37s-.05.92-.15 1.37l.9.8a1 1 0 0 1 .2 1.28l-1.02 1.76a1 1 0 0 1-1.26.34l-1.1-.55c-.42.32-.87.58-1.35.78l-.37 1.12a1 1 0 0 1-.95.68H10.02a1 1 0 0 1-.95-.68l-.37-1.12a7.1 7.1 0 0 1-1.35-.78l-1.1.55a1 1 0 0 1-1.26-.34L3.97 14.9a1 1 0 0 1 .2-1.28l.9-.8A6.9 6.9 0 0 1 4.92 11c0-.46.05-.92.15-1.37l-.9-.8a1 1 0 0 1-.2-1.28l1.02-1.76a1 1 0 0 1 1.26-.34l1.1.55c.42-.32.87-.58 1.35-.78l.37-1.12A1 1 0 0 1 10.02 2h1.96ZM12 8.5A2.5 2.5 0 1 0 12 13.5 2.5 2.5 0 0 0 12 8.5Z"/>
    </svg>
  </button>`;
}

function renderSettingsPanel(): string {
  if (!state.settingsOpen) return "";
  return `
    <div class="settings-backdrop" id="settings-backdrop">
      <div class="settings-panel" id="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings__head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" class="outs__close" id="btn-close-settings" aria-label="Close">×</button>
        </header>
        <div class="settings__row">
          <span>
            <strong>4 color deck</strong>
            <small>Spades black · Hearts red · Diamonds blue · Clubs green</small>
          </span>
          <button
            type="button"
            class="ios-switch${state.fourColorDeck ? " ios-switch--on" : ""}"
            id="setting-four-color"
            role="switch"
            aria-checked="${state.fourColorDeck}"
            aria-label="4 color deck"
          >
            <span class="ios-switch__knob"></span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderCard(
  card: Card | null,
  opts: { compact?: boolean; pickPlayer?: number; pickSlot?: number } = {},
): string {
  const { compact = false, pickPlayer, pickSlot } = opts;
  const pickAttrs =
    pickPlayer !== undefined && pickSlot !== undefined
      ? ` data-pick-player="${pickPlayer}" data-pick-slot="${pickSlot}" role="button" tabindex="0"`
      : "";
  const pickClass = pickAttrs ? " card--pickable" : "";

  if (card === null) {
    return `<div class="card card--empty${compact ? " card--sm" : ""}${pickClass}"${pickAttrs} aria-label="Empty card slot"></div>`;
  }
  const str = cardToString(card);
  const rank = str[0];
  const suit = str[1];
  const color = suitColorClass(suit);
  return `
    <div class="card card--face ${color}${compact ? " card--sm" : ""}${pickClass}" title="${str}"${pickAttrs} aria-label="${str}">
      <span class="card__rank">${rank}</span>
      <span class="card__suit">${SUIT_GLYPH[suit]}</span>
    </div>
  `;
}

function seatStyle(index: number, total: number): string {
  const angle = Math.PI / 2 + (2 * Math.PI * index) / total;
  const left = 50 + 38 * Math.cos(angle);
  const top = 50 + 34 * Math.sin(angle);
  return `left:${left.toFixed(2)}%;top:${top.toFixed(2)}%`;
}

function leadingEquity(): number {
  if (!state.equities?.length) return 0;
  return Math.max(...state.equities);
}

function isTrailing(seat: number): boolean {
  if (!state.equities) return false;
  if (state.street !== "flop" && state.street !== "turn") return false;
  const eq = state.equities[seat];
  const lead = leadingEquity();
  // Behind the leader (not tied for the lead).
  return eq < lead - 0.05;
}

function isWinner(seat: number): boolean {
  if (state.street !== "river" || !state.equities) return false;
  return state.equities[seat] >= leadingEquity() - 0.05 && leadingEquity() > 0;
}

function canShowOuts(): boolean {
  return state.street === "flop" || state.street === "turn";
}

/** Worst trailing seat, or null if nobody is behind. Keeps `prefer` if still trailing. */
function pickTrailingSeat(prefer: number | null = null): number | null {
  if (!canShowOuts() || !state.equities) return null;
  const trailers = state.equities
    .map((eq, i) => ({ eq, i }))
    .filter(({ i }) => isTrailing(i))
    .sort((a, b) => a.eq - b.eq);
  if (trailers.length === 0) return null;
  if (prefer !== null && trailers.some((t) => t.i === prefer)) return prefer;
  return trailers[0].i;
}

function syncOutsSeat() {
  if (state.outsSeat === null) return;
  // Follow whoever is currently losing (lowest equity among trailers).
  state.outsSeat = pickTrailingSeat(null);
}

function renderSetup(): string {
  const max = MAX_PLAYERS[state.gameType];
  const playerOptions = Array.from(
    { length: max - MIN_PLAYERS + 1 },
    (_, i) => MIN_PLAYERS + i,
  )
    .map(
      (n) =>
        `<option value="${n}" ${n === state.playerCount ? "selected" : ""}>${n}</option>`,
    )
    .join("");

  return `
    <main class="page page--setup">
      <header class="brand brand--with-actions">
        <div>
          <h1>PokerFlipper</h1>
          <p>Set up a table, deal hands, run the board.</p>
        </div>
        ${renderGearButton()}
      </header>

      <form id="setup-form" class="panel">
        <fieldset>
          <legend>Game</legend>
          <label class="choice">
            <input type="radio" name="gameType" value="holdem" ${
              state.gameType === "holdem" ? "checked" : ""
            } />
            <span>
              <strong>Hold'em</strong>
              <small>2 hole cards per player</small>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="gameType" value="omaha" ${
              state.gameType === "omaha" ? "checked" : ""
            } />
            <span>
              <strong>Omaha</strong>
              <small>4 hole cards per player</small>
            </span>
          </label>
        </fieldset>

        <label class="field">
          Players
          <select name="playerCount" id="player-count">
            ${playerOptions}
          </select>
        </label>

        <button type="submit" class="btn btn--primary">Start table</button>
      </form>
    </main>
  `;
}

function renderOutsSidebar(seat: number): string {
  const result = findOuts(
    state.gameType,
    filledHands(),
    filledBoard(),
    seat,
  );
  const streetName = state.street === "flop" ? "turn" : "river";
  const cards =
    result.outs.length === 0
      ? `<p class="outs__empty">No single ${streetName} card takes the lead.</p>`
      : `<div class="outs__grid">${result.outs.map((c) => renderCard(c, { compact: true })).join("")}</div>`;

  const switcher =
    state.playerCount > 2
      ? `<div class="outs__tabs" role="tablist" aria-label="Player">
          ${Array.from({ length: state.playerCount }, (_, i) => {
            const active = i === seat ? " outs__tab--active" : "";
            const eq = state.equities ? `${state.equities[i].toFixed(0)}%` : "";
            return `<button type="button" class="outs__tab${active}" data-outs-tab="${i}" role="tab" aria-selected="${i === seat}">
              P${i + 1}${eq ? ` <span>${eq}</span>` : ""}
            </button>`;
          }).join("")}
        </div>`
      : "";

  return `
    <aside class="outs-sidebar" aria-labelledby="outs-title">
      <header class="outs__head">
        <h2 id="outs-title">Outs</h2>
        <button type="button" class="outs__close" id="btn-close-outs" aria-label="Close outs">×</button>
      </header>
      ${switcher}
      <p class="outs__player">P${seat + 1} · to lead on the ${streetName}</p>
      <p class="outs__summary">
        <strong>${result.outs.length}</strong> of ${result.candidates} unseen cards
      </p>
      ${cards}
    </aside>
  `;
}

function renderTable(): string {
  const holes = HOLE_COUNT[state.gameType];
  const lead = leadingEquity();

  const seats = state.hands
    .map((hand, i) => {
      const eq = state.equities ? state.equities[i] : null;
      const trailing = isTrailing(i);
      const winner = isWinner(i);
      const isLead =
        eq !== null && state.street !== "predeal" && eq >= lead - 0.05 && lead > 0;
      const eqClass = isLead ? "seat__equity seat__equity--lead" : "seat__equity";
      const seatClass = winner ? "seat seat--winner" : "seat";

      return `
        <div class="${seatClass}" style="${seatStyle(i, state.playerCount)}" data-seat="${i}">
          ${winner ? `<div class="seat__winner">Winner</div>` : ""}
          <div class="seat__cards">
            ${hand.map((c, slot) => renderCard(c, { pickPlayer: i, pickSlot: slot })).join("")}
          </div>
          <div class="seat__label">P${i + 1}</div>
          ${
            eq !== null
              ? `<div class="${eqClass}">${eq.toFixed(1)}%</div>`
              : ""
          }
          ${
            trailing
              ? `<button type="button" class="btn btn--outs" data-outs="${i}">View outs</button>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  const canFlop = state.street === "holes";
  const canTurn = state.street === "flop";
  const canRiver = state.street === "turn";
  const sidebarOpen = state.outsSeat !== null && canShowOuts();

  return `
    <main class="page page--table${sidebarOpen ? " page--table-sidebar" : ""}">
      <div class="table-shell">
        <header class="table-bar">
          <div>
            <h1>PokerFlipper</h1>
            <p class="meta">${gameLabel(state.gameType)} · ${state.playerCount} players · ${holes} hole cards</p>
          </div>
          <div class="table-bar__actions">
            ${renderGearButton()}
            <button type="button" class="btn btn--ghost" id="btn-setup">Setup</button>
          </div>
        </header>

        <div class="felt">
          <div class="board">
            <div class="board__label">Board</div>
            <div class="board__cards">
              ${state.board.map((c) => renderCard(c)).join("")}
            </div>
          </div>
          ${seats}
        </div>

        <div class="actions">
          <button type="button" class="btn btn--primary" id="btn-deal-holes">
            Deal hands
          </button>
          <button type="button" class="btn" id="btn-deal-flop" ${
            canFlop ? "" : "disabled"
          }>
            Deal flop
          </button>
          <button type="button" class="btn" id="btn-deal-turn" ${
            canTurn ? "" : "disabled"
          }>
            Deal turn
          </button>
          <button type="button" class="btn" id="btn-deal-river" ${
            canRiver ? "" : "disabled"
          }>
            Deal river
          </button>
        </div>
        <p class="hint">${hintForStreet(state.street)}</p>
      </div>
      ${sidebarOpen ? renderOutsSidebar(state.outsSeat!) : ""}
      ${state.picking ? renderCardPicker() : ""}
    </main>
  `;
}

function renderCardPicker(): string {
  if (!state.picking) return "";
  const { player, slot } = state.picking;
  const blocked = usedCards({ player, slot });
  const suitNames: Record<string, string> = {
    s: "Spades",
    h: "Hearts",
    d: "Diamonds",
    c: "Clubs",
  };

  const rows = SUITS.map((suit) => {
    const buttons = RANKS.map((rank) => {
      const card = makeCard(rank, suit);
      const taken = blocked.has(card);
      const color = suitColorClass(suit);
      return `<button type="button" class="picker__card ${color}" data-pick-card="${card}" ${
        taken ? "disabled" : ""
      } title="${rank}${suit}">
        <span>${rank}</span><span>${SUIT_GLYPH[suit]}</span>
      </button>`;
    }).join("");
    return `<div class="picker__suit">
      <div class="picker__suit-label">${SUIT_GLYPH[suit]} ${suitNames[suit]}</div>
      <div class="picker__row">${buttons}</div>
    </div>`;
  }).join("");

  return `
    <div class="picker-backdrop" id="picker-backdrop">
      <aside class="picker-sidebar" id="picker-sidebar">
        <header class="picker__head">
          <div>
            <h2>Pick a card</h2>
            <p>P${player + 1} · slot ${slot + 1}</p>
          </div>
          <button type="button" class="outs__close" id="btn-close-picker" aria-label="Cancel">×</button>
        </header>
        ${rows}
        <button type="button" class="btn btn--ghost picker__clear" id="btn-clear-pick">Clear slot</button>
      </aside>
    </div>
  `;
}

function hintForStreet(street: Street): string {
  switch (street) {
    case "predeal":
      return "Click any card slot to choose it. Deal hands randomizes only empty slots.";
    case "holes":
      return "Click a hole card to change it. Deal the flop when ready.";
    case "flop":
      return "Equity updated. Trailing hands can View outs for the turn.";
    case "turn":
      return "Equity updated. Trailing hands can View outs for the river.";
    case "river":
      return "Board complete — equity is the final result. Deal hands for a new round.";
  }
}

function render() {
  const page = state.screen === "setup" ? renderSetup() : renderTable();
  root.innerHTML = page + renderSettingsPanel();
  bindEvents();
}

function bindSettingsEvents() {
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    state.settingsOpen = true;
    render();
  });
  document.getElementById("btn-close-settings")?.addEventListener("click", () => {
    state.settingsOpen = false;
    render();
  });
  const backdrop = document.getElementById("settings-backdrop");
  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      state.settingsOpen = false;
      render();
    }
  });
  document.getElementById("settings-panel")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  document.getElementById("setting-four-color")?.addEventListener("click", () => {
    state.fourColorDeck = !state.fourColorDeck;
    saveSettings();
    render();
  });
}

function bindEvents() {
  bindSettingsEvents();

  if (state.screen === "setup") {
    const form = document.getElementById("setup-form") as HTMLFormElement;
    form.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      if (target.name === "gameType") {
        state.gameType = target.value as GameType;
        const max = MAX_PLAYERS[state.gameType];
        if (state.playerCount > max) state.playerCount = max;
        render();
      }
      if (target.name === "playerCount" || target.id === "player-count") {
        state.playerCount = Number(
          (document.getElementById("player-count") as HTMLSelectElement).value,
        );
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const select = document.getElementById(
        "player-count",
      ) as HTMLSelectElement;
      state.playerCount = Number(select.value);
      startTable();
    });
    return;
  }

  document.getElementById("btn-setup")?.addEventListener("click", backToSetup);
  document.getElementById("btn-deal-holes")?.addEventListener("click", dealHoles);
  document.getElementById("btn-deal-flop")?.addEventListener("click", dealFlop);
  document.getElementById("btn-deal-turn")?.addEventListener("click", dealTurn);
  document
    .getElementById("btn-deal-river")
    ?.addEventListener("click", dealRiver);

  document.querySelectorAll<HTMLButtonElement>("[data-outs]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.outsSeat = Number(btn.dataset.outs);
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-outs-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.outsSeat = Number(btn.dataset.outsTab);
      render();
    });
  });

  document.getElementById("btn-close-outs")?.addEventListener("click", () => {
    state.outsSeat = null;
    render();
  });

  document.querySelectorAll<HTMLElement>("[data-pick-player]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openPicker(Number(el.dataset.pickPlayer), Number(el.dataset.pickSlot));
    });
  });

  const backdrop = document.getElementById("picker-backdrop");
  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) closePicker();
  });
  document.getElementById("btn-close-picker")?.addEventListener("click", closePicker);
  document.getElementById("btn-clear-pick")?.addEventListener("click", () => {
    assignHoleCard(null);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-pick-card]").forEach((btn) => {
    btn.addEventListener("click", () => {
      assignHoleCard(Number(btn.dataset.pickCard));
    });
  });
  document.getElementById("picker-sidebar")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

render();
