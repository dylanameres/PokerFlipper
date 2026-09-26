import {
  cardToString,
  draw,
  gameLabel,
  HOLE_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  shuffle,
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
}

const root = document.getElementById("app")!;

const state: AppState = {
  screen: "setup",
  gameType: "holdem",
  playerCount: 2,
  deck: [],
  hands: [],
  board: emptyBoard(),
  street: "predeal",
};

function emptyBoard(): (Card | null)[] {
  return [null, null, null, null, null];
}

function emptyHands(players: number, holes: number): (Card | null)[][] {
  return Array.from({ length: players }, () =>
    Array.from({ length: holes }, () => null),
  );
}

function resetTable() {
  const holes = HOLE_COUNT[state.gameType];
  state.deck = shuffle();
  state.hands = emptyHands(state.playerCount, holes);
  state.board = emptyBoard();
  state.street = "predeal";
}

function startTable() {
  resetTable();
  state.screen = "table";
  render();
}

/** Deal hole cards to every seat (Hold'em: 2, Omaha: 4). */
function dealHoles() {
  resetTable();
  const holes = HOLE_COUNT[state.gameType];
  for (let h = 0; h < holes; h++) {
    for (let p = 0; p < state.playerCount; p++) {
      state.hands[p][h] = draw(state.deck, 1)[0];
    }
  }
  state.street = "holes";
  render();
}

function dealFlop() {
  if (state.street !== "holes") return;
  draw(state.deck, 1); // burn
  const flop = draw(state.deck, 3);
  state.board[0] = flop[0];
  state.board[1] = flop[1];
  state.board[2] = flop[2];
  state.street = "flop";
  render();
}

function dealTurn() {
  if (state.street !== "flop") return;
  draw(state.deck, 1);
  state.board[3] = draw(state.deck, 1)[0];
  state.street = "turn";
  render();
}

function dealRiver() {
  if (state.street !== "turn") return;
  draw(state.deck, 1);
  state.board[4] = draw(state.deck, 1)[0];
  state.street = "river";
  render();
}

function backToSetup() {
  state.screen = "setup";
  render();
}

/* ---------- rendering ---------- */

const SUIT_GLYPH: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

function isRed(card: Card): boolean {
  const suit = card & 3;
  return suit === 1 || suit === 2;
}

function renderCard(card: Card | null): string {
  if (card === null) {
    return `<div class="card card--empty" aria-hidden="true"></div>`;
  }
  const str = cardToString(card);
  const rank = str[0];
  const suit = str[1];
  const color = isRed(card) ? "card--red" : "card--black";
  return `
    <div class="card card--face ${color}" title="${str}">
      <span class="card__rank">${rank}</span>
      <span class="card__suit">${SUIT_GLYPH[suit]}</span>
    </div>
  `;
}

/** Seat positions around the felt, starting at the bottom and going clockwise. */
function seatStyle(index: number, total: number): string {
  const angle = Math.PI / 2 + (2 * Math.PI * index) / total;
  const left = 50 + 38 * Math.cos(angle);
  const top = 50 + 34 * Math.sin(angle);
  return `left:${left.toFixed(2)}%;top:${top.toFixed(2)}%`;
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
      <header class="brand">
        <h1>PokerFlipper</h1>
        <p>Set up a table, deal hands, run the board.</p>
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

function renderTable(): string {
  const holes = HOLE_COUNT[state.gameType];
  const seats = state.hands
    .map((hand, i) => {
      return `
        <div class="seat" style="${seatStyle(i, state.playerCount)}" data-seat="${i}">
          <div class="seat__cards">
            ${hand.map(renderCard).join("")}
          </div>
          <div class="seat__label">P${i + 1}</div>
        </div>
      `;
    })
    .join("");

  const canFlop = state.street === "holes";
  const canTurn = state.street === "flop";
  const canRiver = state.street === "turn";

  return `
    <main class="page page--table">
      <header class="table-bar">
        <div>
          <h1>PokerFlipper</h1>
          <p class="meta">${gameLabel(state.gameType)} · ${state.playerCount} players · ${holes} hole cards</p>
        </div>
        <button type="button" class="btn btn--ghost" id="btn-setup">Setup</button>
      </header>

      <div class="felt">
        <div class="board">
          <div class="board__label">Board</div>
          <div class="board__cards">
            ${state.board.map(renderCard).join("")}
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
    </main>
  `;
}

function hintForStreet(street: Street): string {
  switch (street) {
    case "predeal":
      return "Click Deal hands to give every player random hole cards.";
    case "holes":
      return "Hole cards are out. Click Deal flop for three community cards.";
    case "flop":
      return "Flop is out. Deal the turn when you're ready.";
    case "turn":
      return "Turn is out. Deal the river to finish the board.";
    case "river":
      return "Board is complete. Deal hands again to start a new round.";
  }
}

function render() {
  root.innerHTML = state.screen === "setup" ? renderSetup() : renderTable();
  bindEvents();
}

function bindEvents() {
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
}

render();
