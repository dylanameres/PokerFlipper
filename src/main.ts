import {
  cardToString,
  draw,
  findOuts,
  gameLabel,
  HOLE_COUNT,
  liveEquity,
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
  equities: number[] | null;
  /** Seat index whose outs panel is open, or null. */
  outsSeat: number | null;
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
  equities: null,
  outsSeat: null,
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

function resetTable() {
  const holes = HOLE_COUNT[state.gameType];
  state.deck = shuffle();
  state.hands = emptyHands(state.playerCount, holes);
  state.board = emptyBoard();
  state.street = "predeal";
  state.equities = null;
  state.outsSeat = null;
}

function refreshEquity() {
  if (state.street === "predeal") {
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
  resetTable();
  const holes = HOLE_COUNT[state.gameType];
  for (let h = 0; h < holes; h++) {
    for (let p = 0; p < state.playerCount; p++) {
      state.hands[p][h] = draw(state.deck, 1)[0];
    }
  }
  state.street = "holes";
  refreshEquity();
  render();
}

function dealFlop() {
  if (state.street !== "holes") return;
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

function renderCard(card: Card | null, compact = false): string {
  if (card === null) {
    return `<div class="card card--empty${compact ? " card--sm" : ""}" aria-hidden="true"></div>`;
  }
  const str = cardToString(card);
  const rank = str[0];
  const suit = str[1];
  const color = isRed(card) ? "card--red" : "card--black";
  return `
    <div class="card card--face ${color}${compact ? " card--sm" : ""}" title="${str}">
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
  state.outsSeat = pickTrailingSeat(state.outsSeat);
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
      : `<div class="outs__grid">${result.outs.map((c) => renderCard(c, true)).join("")}</div>`;

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
            ${hand.map((c) => renderCard(c)).join("")}
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
          <button type="button" class="btn btn--ghost" id="btn-setup">Setup</button>
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
    </main>
  `;
}

function hintForStreet(street: Street): string {
  switch (street) {
    case "predeal":
      return "Click Deal hands to give every player random hole cards.";
    case "holes":
      return "Live equity shown under each seat. Deal the flop to continue.";
    case "flop":
      return "Equity updated. Trailing hands can View outs for the turn.";
    case "turn":
      return "Equity updated. Trailing hands can View outs for the river.";
    case "river":
      return "Board complete — equity is the final result. Deal hands for a new round.";
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
}

render();
