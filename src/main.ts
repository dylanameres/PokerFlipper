import { ROOM_PROTOCOL, type RoomView } from "../shared/protocol";
import {
  connectOnline,
  disconnectOnline,
  randomRoomCode,
  sendOnline,
} from "./online";
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
type PlayMode = "solo" | "online";

interface AppState {
  screen: Screen;
  mode: PlayMode;
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
  /** Solo only: show equity % and outs UI. */
  showEquity: boolean;
  /** Larger card faces on the table. */
  largeCards: boolean;
  /** Online multiplayer view from room server (null in solo). */
  online: RoomView | null;
  /** False when connected to a room server that predates chip betting. */
  onlineSupportsBetting: boolean;
  roomCode: string;
  joinCode: string;
  onlineError: string | null;
}

const SETTINGS_KEY = "pokerflipper-settings";

interface SavedSettings {
  fourColorDeck: boolean;
  showEquity: boolean;
  largeCards: boolean;
}

function loadSettings(): SavedSettings {
  const defaults: SavedSettings = {
    fourColorDeck: false,
    showEquity: true,
    largeCards: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SavedSettings>;
    return {
      fourColorDeck: Boolean(parsed.fourColorDeck),
      showEquity: parsed.showEquity !== false,
      largeCards: Boolean(parsed.largeCards),
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        fourColorDeck: state.fourColorDeck,
        showEquity: state.showEquity,
        largeCards: state.largeCards,
      } satisfies SavedSettings),
    );
  } catch {
    // ignore quota / private-mode failures
  }
}

const root = document.getElementById("app")!;
const saved = loadSettings();

const state: AppState = {
  screen: "setup",
  mode: "solo",
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
  showEquity: saved.showEquity,
  largeCards: saved.largeCards,
  online: null,
  onlineSupportsBetting: true,
  roomCode: "",
  joinCode: "",
  onlineError: null,
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

function startSoloTable() {
  disconnectOnline();
  state.mode = "solo";
  state.online = null;
  state.onlineError = null;
  resetTable();
  state.screen = "table";
  render();
}

function normalizeOnlineView(view: RoomView): RoomView {
  // Older Workers deploys omit chip/betting fields — fill defaults so render never throws.
  const seats = (view.seats ?? []).map((s) => ({
    filled: Boolean(s.filled),
    connected: Boolean(s.connected),
    chips: typeof s.chips === "number" ? s.chips : 0,
    bet: typeof s.bet === "number" ? s.bet : 0,
    folded: Boolean(s.folded),
    isButton: Boolean(s.isButton),
    isSmallBlind: Boolean(s.isSmallBlind),
    isBigBlind: Boolean(s.isBigBlind),
  }));
  const hasBetting = typeof view.pot === "number";
  return {
    ...view,
    seats,
    pot: typeof view.pot === "number" ? view.pot : 0,
    smallBlind: typeof view.smallBlind === "number" ? view.smallBlind : 25,
    bigBlind: typeof view.bigBlind === "number" ? view.bigBlind : 50,
    buttonSeat: view.buttonSeat ?? null,
    toCall: typeof view.toCall === "number" ? view.toCall : 0,
    minBet: typeof view.minBet === "number" ? view.minBet : 50,
    maxBet: typeof view.maxBet === "number" ? view.maxBet : 0,
    canAct: Boolean(view.canAct),
    canCheck: Boolean(view.canCheck),
    canBet: Boolean(view.canBet),
    bettingOpen: Boolean(view.bettingOpen),
    // Legacy servers have no betting round — treat streets as ready to deal.
    bettingComplete: hasBetting ? Boolean(view.bettingComplete) : true,
    handOver: Boolean(view.handOver),
    winnerSeats: Array.isArray(view.winnerSeats) ? view.winnerSeats : [],
    actionSeat: view.actionSeat ?? null,
  };
}

/** Chip color tier for pot / stack display. */
function potChipTone(pot: number): string {
  if (pot >= 1000) return "black";
  if (pot >= 500) return "green";
  if (pot >= 250) return "blue";
  if (pot >= 100) return "red";
  return "white";
}

function renderPotDisplay(pot: number): string {
  const tone = potChipTone(pot);
  const stack = Math.min(5, Math.max(1, Math.ceil(pot / 50) || 1));
  // i=0 is the top chip; later chips sit below it.
  const chips = Array.from({ length: stack }, (_, i) => {
    const offset = i * 4;
    const z = stack - i;
    return `<span class="chip chip--${tone}" style="--chip-y: ${offset}px; --chip-z: ${z}" aria-hidden="true"></span>`;
  }).join("");
  return `
    <div class="pot" data-tone="${tone}">
      <div class="pot__stack" style="--stack-n: ${stack}">${chips}</div>
      <div class="pot__copy">
        <span class="pot__label">Pot</span>
        <strong class="pot__amount">${pot.toLocaleString()}</strong>
      </div>
    </div>
  `;
}

function applyOnlineView(view: RoomView) {
  state.onlineSupportsBetting = typeof view.pot === "number";
  state.online = normalizeOnlineView(view);
  state.mode = "online";
  state.onlineError = null;
  state.gameType = view.gameType;
  state.playerCount = 2;
  state.street = view.street;
  // Prefer the code the client joined with; server name can be blank on some Workers paths.
  if (view.roomId) state.roomCode = view.roomId;
  state.board = view.board.map((c) => c);
  state.picking = null;

  const holes = HOLE_COUNT[view.gameType];
  state.hands = emptyHands(2, holes);
  if (view.yourSeat !== null) {
    state.hands[view.yourSeat] = view.yourHoles.map((c) => c);
    const opp = 1 - view.yourSeat;
    if (view.revealed && view.opponentHoles) {
      state.hands[opp] = view.opponentHoles.map((c) => c);
    } else {
      // Keep nulls; UI renders card-backs from opponentHidden.
      state.hands[opp] = emptyHands(1, holes)[0];
    }
  }

  // Multiplayer: never show live equity / outs (private info + confusing %).
  state.equities = null;
  state.outsSeat = null;
  state.screen = "table";
  render();
}

function startOnline(roomCode: string) {
  state.mode = "online";
  state.onlineError = null;
  state.roomCode = roomCode.toUpperCase();
  state.screen = "table";
  state.online = null;
  state.street = "predeal";
  state.board = emptyBoard();
  state.hands = emptyHands(2, HOLE_COUNT[state.gameType]);
  state.equities = null;
  state.outsSeat = null;
  state.picking = null;
  render();

  connectOnline(state.roomCode, state.gameType, {
    onView: (view) => applyOnlineView(view),
    onError: (message) => {
      state.onlineError = message;
      render();
    },
    onClose: () => {
      if (state.mode === "online") {
        state.onlineError = state.onlineError ?? "Disconnected from room";
        render();
      }
    },
  });
}

function dealHoles() {
  if (state.mode === "online") {
    sendOnline({ type: "deal_hands" });
    return;
  }

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
  if (state.mode === "online") return; // server deals; no client picks
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
  if (state.mode === "online") {
    sendOnline({ type: "deal_flop" });
    return;
  }
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
  if (state.mode === "online") {
    sendOnline({ type: "deal_turn" });
    return;
  }
  if (state.street !== "flop") return;
  draw(state.deck, 1);
  state.board[3] = draw(state.deck, 1)[0];
  state.street = "turn";
  refreshEquity();
  syncOutsSeat();
  render();
}

function dealRiver() {
  if (state.mode === "online") {
    sendOnline({ type: "deal_river" });
    return;
  }
  if (state.street !== "turn") return;
  draw(state.deck, 1);
  state.board[4] = draw(state.deck, 1)[0];
  state.street = "river";
  state.outsSeat = null; // outs only apply before the river
  refreshEquity();
  render();
}

function backToSetup() {
  disconnectOnline();
  state.screen = "setup";
  state.mode = "solo";
  state.online = null;
  state.onlineError = null;
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
  // Heroicons "cog-6-tooth" outline — readable gear silhouette
  return `<button type="button" class="btn btn--icon" id="btn-settings" aria-label="Settings" title="Settings">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
  </button>`;
}

function settingsSwitchRow(
  id: string,
  title: string,
  detail: string,
  on: boolean,
): string {
  return `
    <button type="button" class="settings__row" data-setting="${id}">
      <span class="settings__copy">
        <strong>${title}</strong>
        <small>${detail}</small>
      </span>
      <span
        class="ios-switch${on ? " ios-switch--on" : ""}"
        role="switch"
        aria-checked="${on}"
      >
        <span class="ios-switch__knob"></span>
      </span>
    </button>
  `;
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
        <div class="settings__list">
          ${settingsSwitchRow(
            "fourColorDeck",
            "4 color deck",
            "Spades black · Hearts red · Diamonds blue · Clubs green",
            state.fourColorDeck,
          )}
          ${settingsSwitchRow(
            "showEquity",
            "Show equity (solo)",
            "Live win % and outs buttons in solo mode",
            state.showEquity,
          )}
          ${settingsSwitchRow(
            "largeCards",
            "Large cards",
            "Bigger card faces on the table",
            state.largeCards,
          )}
        </div>
      </div>
    </div>
  `;
}

function renderCard(
  card: Card | null,
  opts: {
    compact?: boolean;
    pickPlayer?: number;
    pickSlot?: number;
    faceDown?: boolean;
  } = {},
): string {
  const { compact = false, pickPlayer, pickSlot, faceDown = false } = opts;
  const pickAttrs =
    !faceDown && pickPlayer !== undefined && pickSlot !== undefined
      ? ` data-pick-player="${pickPlayer}" data-pick-slot="${pickSlot}" role="button" tabindex="0"`
      : "";
  const pickClass = pickAttrs ? " card--pickable" : "";

  if (faceDown) {
    return `<div class="card card--back${compact ? " card--sm" : ""}" aria-label="Face-down card"></div>`;
  }
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

/** Online: always put hero on the bottom rail and villain on top. */
function onlineLayoutIndex(seat: number, yourSeat: number | null): number {
  if (yourSeat === null) return seat;
  return seat === yourSeat ? 0 : 1;
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
  if (state.mode === "online") {
    return Boolean(state.online?.winnerSeats?.includes(seat));
  }
  if (state.street !== "river" || !state.equities) return false;
  return state.equities[seat] >= leadingEquity() - 0.05 && leadingEquity() > 0;
}

function renderBettingBar(online: RoomView): string {
  if (!online.bettingOpen && !online.canAct) return "";
  if (!online.canAct) {
    return `<div class="bet-bar bet-bar--wait"><span>Waiting for opponent…</span></div>`;
  }
  const callLabel = online.canCheck
    ? "Check"
    : `Call ${online.toCall}`;
  const betLabel = online.toCall > 0 ? "Raise to" : "Bet";
  const defaultAmt = online.minBet || 20;
  return `
    <div class="bet-bar">
      <button type="button" class="btn btn--ghost" id="btn-fold">Fold</button>
      <button type="button" class="btn" id="btn-call">${callLabel}</button>
      ${
        online.canBet
          ? `<label class="bet-bar__amount">
              <span>${betLabel}</span>
              <input type="number" id="bet-amount" min="${online.minBet}" max="${online.maxBet}" value="${defaultAmt}" step="10" />
            </label>
            <button type="button" class="btn btn--primary" id="btn-bet">${betLabel}</button>`
          : ""
      }
    </div>
  `;
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

  const soloFields = `
        <label class="field">
          Players
          <select name="playerCount" id="player-count">
            ${playerOptions}
          </select>
        </label>
        <button type="submit" class="btn btn--primary" data-setup-action="solo">Start table</button>
  `;

  const onlineFields = `
        <p class="setup-note">2 players · 1000 chips · blinds 25/50 · button rotates each hand · hole cards private until showdown</p>
        <button type="button" class="btn btn--primary" id="btn-create-room">Create room</button>
        <div class="join-row">
          <input
            id="join-code"
            name="joinCode"
            maxlength="6"
            placeholder="ROOM"
            value="${state.joinCode}"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="btn" id="btn-join-room">Join</button>
        </div>
        ${
          state.onlineError
            ? `<p class="error">${state.onlineError}</p>`
            : ""
        }
  `;

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
        <div class="mode-tabs">
          <button type="button" class="mode-tab${
            state.mode === "solo" ? " mode-tab--active" : ""
          }" data-mode="solo">Solo</button>
          <button type="button" class="mode-tab${
            state.mode === "online" ? " mode-tab--active" : ""
          }" data-mode="online">Online</button>
        </div>

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

        ${state.mode === "solo" ? soloFields : onlineFields}
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
  const online = state.mode === "online" ? state.online : null;
  const hostCanDeal = !online || online.youAreHost;
  const showEquityUi = state.mode === "solo" && state.showEquity;
  const streetReady = !online || online.bettingComplete;

  const seats = state.hands
    .map((hand, i) => {
      const eq = showEquityUi && state.equities ? state.equities[i] : null;
      const trailing = showEquityUi && isTrailing(i);
      const winner = isWinner(i);
      const isLead =
        eq !== null && state.street !== "predeal" && eq >= lead - 0.05 && lead > 0;
      const eqClass = isLead ? "seat__equity seat__equity--lead" : "seat__equity";
      const folded = Boolean(online?.seats[i]?.folded);
      const seatClass = [
        "seat",
        winner ? "seat--winner" : "",
        folded ? "seat--folded" : "",
        online?.actionSeat === i ? "seat--turn" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const isYou = online?.yourSeat === i;
      const oppSeat = online && online.yourSeat !== null ? 1 - online.yourSeat : -1;
      const showBacks =
        online &&
        i === oppSeat &&
        !online.revealed &&
        online.opponentHidden.some(Boolean);
      const seatInfo = online?.seats[i];
      const roleBadges = seatInfo
        ? [
            seatInfo.isButton ? `<span class="seat__badge seat__badge--d" title="Dealer">D</span>` : "",
            seatInfo.isSmallBlind ? `<span class="seat__badge seat__badge--sb" title="Small blind">SB</span>` : "",
            seatInfo.isBigBlind ? `<span class="seat__badge seat__badge--bb" title="Big blind">BB</span>` : "",
          ]
            .filter(Boolean)
            .join("")
        : "";
      const chipsHtml =
        seatInfo && typeof seatInfo.chips === "number"
          ? `<div class="seat__chips">${seatInfo.chips.toLocaleString()} chips${
              seatInfo.bet > 0 ? ` · bet ${seatInfo.bet}` : ""
            }${folded ? " · folded" : ""}</div>`
          : "";

      const layoutIndex =
        online && online.yourSeat !== null
          ? onlineLayoutIndex(i, online.yourSeat)
          : i;

      return `
        <div class="${seatClass}" style="${seatStyle(layoutIndex, state.playerCount)}" data-seat="${i}">
          ${winner ? `<div class="seat__winner">Winner</div>` : ""}
          ${roleBadges ? `<div class="seat__badges">${roleBadges}</div>` : ""}
          <div class="seat__cards">
            ${hand
              .map((c, slot) =>
                renderCard(c, {
                  pickPlayer: state.mode === "solo" ? i : undefined,
                  pickSlot: state.mode === "solo" ? slot : undefined,
                  faceDown: Boolean(showBacks && online?.opponentHidden[slot]),
                }),
              )
              .join("")}
          </div>
          <div class="seat__label">${isYou ? "You" : `P${i + 1}`}${
            online?.seats[i]?.connected === false ? " (away)" : ""
          }</div>
          ${chipsHtml}
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

  const canFlop = state.street === "holes" && hostCanDeal && streetReady;
  const canTurn = state.street === "flop" && hostCanDeal && streetReady;
  const canRiver = state.street === "turn" && hostCanDeal && streetReady;
  const canDealHands =
    hostCanDeal &&
    (state.mode === "solo"
      ? true
      : Boolean(
          online &&
            online.seats.every((s) => s.filled) &&
            (online.street === "predeal" ||
              online.handOver ||
              !state.onlineSupportsBetting),
        ));
  const sidebarOpen =
    showEquityUi && state.outsSeat !== null && canShowOuts();

  const roomCode = state.roomCode || online?.roomId || "";
  const meta =
    state.mode === "online"
      ? `${gameLabel(state.gameType)} · ${
          online ? (online.youAreHost ? "Host" : "Guest") : "Connecting…"
        }${
          online
            ? ` · Blinds ${online.smallBlind}/${online.bigBlind}`
            : ""
        }`
      : `${gameLabel(state.gameType)} · ${state.playerCount} players · ${holes} hole cards`;

  return `
    <main class="page page--table${sidebarOpen ? " page--table-sidebar" : ""}">
      <div class="table-shell">
        <header class="table-bar">
          <div>
            <h1>PokerFlipper</h1>
            <p class="meta">${meta}</p>
            ${
              state.mode === "online" && roomCode
                ? `<p class="room-code">Room code <strong id="room-code-value">${roomCode}</strong></p>`
                : ""
            }
            ${
              online
                ? `<p class="meta">${online.status}</p>`
                : state.mode === "online"
                  ? `<p class="meta">Connecting to room…</p>`
                  : ""
            }
            ${
              state.onlineError
                ? `<p class="error">${state.onlineError}</p>`
                : ""
            }
            ${
              online &&
              (typeof online.protocol !== "number" ||
                online.protocol < ROOM_PROTOCOL)
                ? `<p class="error">Room server is outdated (no blinds). On your Mac run: <code>git pull && npm install && npm run deploy:party</code></p>`
                : ""
            }
          </div>
          <div class="table-bar__actions">
            ${renderGearButton()}
            <button type="button" class="btn btn--ghost" id="btn-setup">Setup</button>
          </div>
        </header>

        <div class="felt">
          <div class="board">
            ${online ? renderPotDisplay(online.pot) : `<div class="board__label">Board</div>`}
            <div class="board__cards">
              ${state.board.map((c) => renderCard(c)).join("")}
            </div>
          </div>
          ${seats}
        </div>

        ${online ? renderBettingBar(online) : ""}

        <div class="actions">
          <button type="button" class="btn btn--primary" id="btn-deal-holes" ${
            canDealHands ? "" : "disabled"
          }>
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
        <p class="hint">${
          online ? online.status : hintForStreet(state.street)
        }</p>
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
  document.documentElement.classList.toggle("large-cards", state.largeCards);
  const page = state.screen === "setup" ? renderSetup() : renderTable();
  root.innerHTML = page + renderSettingsPanel();
  bindEvents();
}

function toggleSetting(key: "fourColorDeck" | "showEquity" | "largeCards") {
  state[key] = !state[key];
  if (key === "showEquity" && !state.showEquity) {
    state.outsSeat = null;
  }
  saveSettings();
  render();
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
  document.getElementById("settings-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      state.settingsOpen = false;
      render();
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-setting]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.setting as
        | "fourColorDeck"
        | "showEquity"
        | "largeCards";
      toggleSetting(key);
    });
  });
}

function bindEvents() {
  bindSettingsEvents();

  if (state.screen === "setup") {
    const form = document.getElementById("setup-form") as HTMLFormElement;
    document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.mode = btn.dataset.mode as PlayMode;
        state.onlineError = null;
        render();
      });
    });
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
      if (state.mode !== "solo") return;
      const select = document.getElementById(
        "player-count",
      ) as HTMLSelectElement;
      state.playerCount = Number(select.value);
      startSoloTable();
    });
    document.getElementById("btn-create-room")?.addEventListener("click", () => {
      startOnline(randomRoomCode());
    });
    document.getElementById("btn-join-room")?.addEventListener("click", () => {
      const input = document.getElementById("join-code") as HTMLInputElement;
      const code = (input?.value || "").trim().toUpperCase();
      if (code.length < 3) {
        state.onlineError = "Enter a room code";
        render();
        return;
      }
      state.joinCode = code;
      startOnline(code);
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

  document.getElementById("btn-fold")?.addEventListener("click", () => {
    sendOnline({ type: "fold" });
  });
  document.getElementById("btn-call")?.addEventListener("click", () => {
    sendOnline({ type: "call" });
  });
  document.getElementById("btn-bet")?.addEventListener("click", () => {
    const input = document.getElementById("bet-amount") as HTMLInputElement | null;
    const amount = Number(input?.value ?? 0);
    sendOnline({ type: "bet", amount });
  });

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
