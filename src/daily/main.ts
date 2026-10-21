import { SUIT_GLYPH, SUIT_NAMES, suitColorClass } from "../cardFace";
import { cardToString, makeCard, rankLabel, RANKS, SUITS, type Card } from "../poker/cards";
import { HAND_CATEGORY_NAMES, type HandCategory } from "../poker/evaluator";
import { dayKey, formatCountdown, formatDayKey, msUntilNextDay } from "./calendar";
import {
  cardKnowledge,
  categoryForPuzzle,
  categoryFound,
  HAND_SIZE,
  handOfCategory,
  isSolved,
  MAX_GUESSES,
  scoreGuess,
  shareRow,
  sortCards,
  type CardFeedback,
  type Mark,
} from "./guessHand";
import { todaysPuzzle, type DailyPuzzle } from "./puzzle";
import {
  liveStreak,
  loadProgress,
  loadStats,
  recordResult,
  saveProgress,
  saveStats,
  winRate,
  type DailyProgress,
  type DailyStats,
} from "./stats";

type Dialog = "help" | "stats" | null;

interface DailyState {
  puzzle: DailyPuzzle;
  category: HandCategory;
  answer: Card[];
  progress: DailyProgress<Card[]>;
  history: CardFeedback[][];
  draft: (Card | null)[];
  /** Draft slot the card picker is filling, or null when it's closed. */
  pickingSlot: number | null;
  stats: DailyStats;
  dialog: Dialog;
  shareCopied: boolean;
  fourColorDeck: boolean;
  error: string | null;
}

const HELP_SEEN_KEY = "pokerflipper-daily-help-seen";
const TABLE_SETTINGS_KEY = "pokerflipper-settings";
const STATS_DELAY_MS = 1400;

const root = document.getElementById("app")!;

function loadFourColorDeck(): boolean {
  try {
    const raw = localStorage.getItem(TABLE_SETTINGS_KEY);
    return raw ? Boolean((JSON.parse(raw) as { fourColorDeck?: boolean }).fourColorDeck) : false;
  } catch {
    return false;
  }
}

function emptyDraft(): (Card | null)[] {
  return Array<Card | null>(HAND_SIZE).fill(null);
}

function freshState(): DailyState {
  const puzzle = todaysPuzzle();
  const category = categoryForPuzzle(puzzle.number);
  const answer = handOfCategory(category, puzzle.rng);
  const progress = loadProgress<Card[]>(puzzle.day);
  return {
    puzzle,
    category,
    answer,
    progress,
    history: progress.moves.map((guess) => scoreGuess(guess, answer)),
    draft: emptyDraft(),
    pickingSlot: null,
    stats: loadStats(),
    dialog: null,
    shareCopied: false,
    fourColorDeck: loadFourColorDeck(),
    error: null,
  };
}

const state = freshState();

function shouldShowHelpOnce(): boolean {
  try {
    if (localStorage.getItem(HELP_SEEN_KEY)) return false;
    localStorage.setItem(HELP_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function isFinished(): boolean {
  return state.progress.status !== "playing";
}

function clueVisible(): boolean {
  return Boolean(state.progress.clueUsed) || isFinished();
}

function draftComplete(): boolean {
  return state.draft.every((c) => c !== null);
}

/* ---------- actions ---------- */

function revealClue() {
  state.progress = { ...state.progress, clueUsed: true };
  saveProgress(state.progress);
  render();
}

function openPicker(slot: number) {
  if (isFinished()) return;
  state.pickingSlot = slot;
  state.error = null;
  render();
}

function closePicker() {
  state.pickingSlot = null;
  render();
}

function pickCard(card: Card | null) {
  const slot = state.pickingSlot;
  if (slot === null) return;
  state.draft[slot] = card;
  if (card === null) {
    render();
    return;
  }
  const next = [...state.draft.keys()]
    .map((i) => (slot + 1 + i) % HAND_SIZE)
    .find((i) => state.draft[i] === null);
  state.pickingSlot = next ?? null;
  render();
}

function clearDraft() {
  state.draft = emptyDraft();
  state.error = null;
  render();
}

function submitGuess() {
  if (isFinished() || !draftComplete()) return;
  const guess = sortCards(state.draft as Card[]);
  const repeat = state.progress.moves.some((m) => m.every((c, i) => c === guess[i]));
  if (repeat) {
    state.error = "You already tried that hand.";
    render();
    return;
  }

  const feedback = scoreGuess(guess, state.answer);
  const moves = [...state.progress.moves, guess];
  const won = isSolved(feedback);
  const status = won ? "won" : moves.length >= MAX_GUESSES ? "lost" : "playing";
  state.progress = { ...state.progress, moves, status };
  state.history = [...state.history, feedback];
  state.draft = emptyDraft();
  state.pickingSlot = null;
  state.error = null;
  saveProgress(state.progress);

  if (status !== "playing") {
    state.stats = recordResult(state.stats, state.puzzle.day, won, moves.length);
    saveStats(state.stats);
    window.setTimeout(() => {
      if (state.dialog === null) openDialog("stats");
    }, STATS_DELAY_MS);
  }
  render();
}

function shareText(): string {
  const { number } = state.puzzle;
  const score = state.progress.status === "won" ? `${state.progress.moves.length}` : "X";
  const clue = state.progress.clueUsed ? " · clue" : "";
  const rows = state.history.map(shareRow).join("\n");
  return `PokerFlipper Daily #${number} ${score}/${MAX_GUESSES}${clue}\n${rows}\n${window.location.origin}/daily`;
}

async function copyShare() {
  try {
    await navigator.clipboard.writeText(shareText());
    state.shareCopied = true;
    render();
    window.setTimeout(() => {
      state.shareCopied = false;
      render();
    }, 1600);
  } catch {
    // clipboard blocked (insecure origin / permissions) — nothing to do
  }
}

function openDialog(dialog: Dialog) {
  state.dialog = dialog;
  render();
}

/* ---------- rendering ---------- */

function renderFace(card: Card, extraClass = "", inner = "", attrs = ""): string {
  const str = cardToString(card);
  const rank = rankLabel(str[0]);
  const suit = str[1];
  const color = suitColorClass(suit, state.fourColorDeck);
  return `<div class="card card--face ${color} daily-card ${extraClass}" title="${rank}${suit}" aria-label="${rank} of ${SUIT_NAMES[suit]}"${attrs}>
    <span class="card__rank">${rank}</span>
    <span class="card__suit">${SUIT_GLYPH[suit]}</span>
    ${inner}
  </div>`;
}

const MARK_LABEL: Record<Mark, string> = {
  green: "correct",
  yellow: "right rank, wrong suit",
  gray: "not in the hand",
};

function renderFeedbackCard(fb: CardFeedback): string {
  const pip =
    fb.mark === "yellow" && fb.color
      ? `<span class="daily-pip daily-pip--${fb.color}" title="The hidden ${rankLabel(
          cardToString(fb.card)[0],
        )} is ${fb.color}"></span>`
      : "";
  const hint = fb.color ? `, hidden card is ${fb.color}` : "";
  return renderFace(
    fb.card,
    `daily-card--${fb.mark}`,
    pip,
    ` data-mark="${MARK_LABEL[fb.mark]}${hint}"`,
  );
}

function renderDraftSlot(card: Card | null, slot: number): string {
  const active = state.pickingSlot === slot ? " daily-slot--active" : "";
  const attrs = ` data-slot="${slot}" role="button" tabindex="0"`;
  if (card === null) {
    return `<div class="card card--empty daily-card daily-slot${active}"${attrs} aria-label="Pick card ${slot + 1}"></div>`;
  }
  return renderFace(card, `daily-slot${active}`, "", attrs);
}

function renderRows(): string {
  const rows: string[] = state.history.map(
    (row) => `<div class="daily-row">${row.map(renderFeedbackCard).join("")}</div>`,
  );
  if (!isFinished()) {
    rows.push(
      `<div class="daily-row daily-row--current">${state.draft.map(renderDraftSlot).join("")}</div>`,
    );
  }
  while (rows.length < MAX_GUESSES) {
    rows.push(
      `<div class="daily-row daily-row--future">${Array.from(
        { length: HAND_SIZE },
        () => `<div class="card card--empty daily-card" aria-hidden="true"></div>`,
      ).join("")}</div>`,
    );
  }
  return rows.join("");
}

function renderClue(): string {
  const name = HAND_CATEGORY_NAMES[state.category];
  if (categoryFound(state.progress.moves, state.answer)) {
    return `<p class="daily-clue daily-clue--found">✓ Hand type: <strong>${name}</strong></p>`;
  }
  if (clueVisible()) {
    return `<p class="daily-clue">Hand type: <strong>${name}</strong></p>`;
  }
  return `<button type="button" class="btn btn--ghost daily-clue-btn" id="btn-clue">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>
    Clue: reveal hand type
  </button>`;
}

function renderStatus(): string {
  const { status, moves } = state.progress;
  if (status === "won") {
    return `<p class="daily-status daily-status--won">Solved in ${moves.length}/${MAX_GUESSES}!</p>`;
  }
  if (status === "lost") {
    return `
      <p class="daily-status daily-status--lost">Out of guesses. Today's hand:</p>
      <div class="daily-row daily-row--answer">${state.answer.map((c) => renderFace(c)).join("")}</div>
    `;
  }
  const error = state.error ? `<p class="error daily-error">${state.error}</p>` : "";
  return `<p class="daily-status">Guess ${moves.length + 1} of ${MAX_GUESSES}</p>${error}`;
}

function renderActions(): string {
  if (isFinished()) {
    return `
      <div class="actions daily-actions">
        <button type="button" class="btn btn--primary" id="btn-share">${state.shareCopied ? "Copied!" : "Share"}</button>
        <button type="button" class="btn" id="btn-stats-inline">Statistics</button>
      </div>
    `;
  }
  const hasAny = state.draft.some((c) => c !== null);
  return `
    <div class="actions daily-actions">
      <button type="button" class="btn" id="btn-clear-draft" ${hasAny ? "" : "disabled"}>Clear</button>
      <button type="button" class="btn btn--primary" id="btn-guess" ${draftComplete() ? "" : "disabled"}>Guess</button>
    </div>
  `;
}

function renderPicker(): string {
  const slot = state.pickingSlot;
  if (slot === null) return "";
  const known = cardKnowledge(state.history);
  const inDraft = new Set(state.draft.filter((c, i): c is Card => c !== null && i !== slot));

  const rows = SUITS.map((suit) => {
    const buttons = RANKS.map((rank) => {
      const card = makeCard(rank, suit);
      const mark = known.get(card);
      const color = suitColorClass(suit, state.fourColorDeck);
      const markClass = mark ? ` picker__card--${mark}` : "";
      return `<button type="button" class="picker__card ${color}${markClass}" data-pick-card="${card}" ${
        inDraft.has(card) ? "disabled" : ""
      } title="${rankLabel(rank)}${suit}${mark ? ` · ${MARK_LABEL[mark]}` : ""}">
        <span>${rankLabel(rank)}</span><span>${SUIT_GLYPH[suit]}</span>
      </button>`;
    }).join("");
    return `<div class="picker__suit">
      <div class="picker__suit-label">${SUIT_GLYPH[suit]} ${SUIT_NAMES[suit]}</div>
      <div class="picker__row">${buttons}</div>
    </div>`;
  }).join("");

  return `
    <div class="picker-backdrop" id="picker-backdrop">
      <aside class="picker-sidebar" id="picker-sidebar">
        <header class="picker__head">
          <div>
            <h2>Pick a card</h2>
            <p>Card ${slot + 1} of ${HAND_SIZE}</p>
          </div>
          <button type="button" class="outs__close" id="btn-close-picker" aria-label="Close">×</button>
        </header>
        ${rows}
        <button type="button" class="btn btn--ghost picker__clear" id="btn-clear-pick">Clear slot</button>
      </aside>
    </div>
  `;
}

function renderIconButton(id: string, label: string, path: string): string {
  return `<button type="button" class="btn btn--icon" id="${id}" aria-label="${label}" title="${label}">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>
  </button>`;
}

function renderDialogShell(id: string, title: string, body: string): string {
  return `
    <div class="settings-backdrop" id="daily-backdrop">
      <div class="settings-panel daily-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <header class="settings__head">
          <h2 id="${id}">${title}</h2>
          <button type="button" class="outs__close" id="btn-close-dialog" aria-label="Close">×</button>
        </header>
        ${body}
      </div>
    </div>
  `;
}

function renderHelpDialog(): string {
  const example: CardFeedback[] = [
    { card: makeCard("A", "s"), mark: "green" },
    { card: makeCard("K", "s"), mark: "yellow", color: "black" },
    { card: makeCard("7", "d"), mark: "gray" },
  ];
  return renderDialogShell(
    "daily-help-title",
    "How to play",
    `
      <div class="daily-help">
        <p>Find today's hidden 5-card poker hand in ${MAX_GUESSES} guesses. Order doesn't matter.</p>
        <p>Tap a slot to pick cards, then press <strong>Guess</strong>.</p>
        <div class="daily-row daily-help__example">${example.map(renderFeedbackCard).join("")}</div>
        <ul class="daily-help__list">
          <li><span class="daily-key daily-key--green"></span><strong>A♠</strong> is in the hand.</li>
          <li><span class="daily-key daily-key--yellow"></span>There's a <strong>King</strong>, but not the ♠. The dot shows the hidden King's color: it's black, so it's the ♣.</li>
          <li><span class="daily-key daily-key--gray"></span><strong>7♦</strong> isn't in the hand.</li>
        </ul>
        <p>Stuck? The <strong>Clue</strong> button reveals the hand type (pair, flush, and so on). Guess a hand of the right type and it's revealed in green for free.</p>
        <p class="daily-help__muted">Everyone gets the same hand. A new one unlocks at midnight in your time zone.</p>
      </div>
    `,
  );
}

function renderDistribution(): string {
  const counts = state.stats.guessCounts;
  const max = Math.max(1, ...counts);
  const today = state.progress.status === "won" ? state.progress.moves.length : null;
  return `
    <h3 class="daily-dist__title">Guess distribution</h3>
    <div class="daily-dist">
      ${counts
        .map(
          (n, i) => `
        <div class="daily-dist__row">
          <span>${i + 1}</span>
          <div class="daily-dist__bar${today === i + 1 ? " daily-dist__bar--today" : ""}" style="width: ${Math.max(
            8,
            (n / max) * 100,
          )}%">${n}</div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

function renderStatsDialog(): string {
  const { stats } = state;
  const cells: [string, number][] = [
    ["Played", stats.played],
    ["Win %", winRate(stats)],
    ["Streak", liveStreak(stats, state.puzzle.day)],
    ["Best", stats.maxStreak],
  ];
  return renderDialogShell(
    "daily-stats-title",
    "Statistics",
    `
      <div class="daily-stats">
        ${cells
          .map(
            ([label, value]) => `
          <div class="daily-stats__cell">
            <strong>${value}</strong>
            <span>${label}</span>
          </div>`,
          )
          .join("")}
      </div>
      ${renderDistribution()}
      <div class="daily-stats__footer">
        <div>
          <span class="daily-stats__label">Next puzzle</span>
          <strong class="daily-countdown" data-countdown>${formatCountdown(msUntilNextDay())}</strong>
        </div>
        <button type="button" class="btn btn--primary" id="btn-share-dialog" ${isFinished() ? "" : "disabled"}>
          ${state.shareCopied ? "Copied!" : "Share"}
        </button>
      </div>
    `,
  );
}

function renderDialog(): string {
  if (state.dialog === "help") return renderHelpDialog();
  if (state.dialog === "stats") return renderStatsDialog();
  return "";
}

function render() {
  const { puzzle } = state;
  root.innerHTML = `
    <main class="page page--daily">
      <header class="daily-head">
        <div>
          <h1>Daily <span class="daily-head__number">#${puzzle.number}</span></h1>
          <p class="daily-head__date">${formatDayKey(puzzle.day)}</p>
        </div>
        <div class="daily-head__actions">
          ${renderIconButton(
            "btn-help",
            "How to play",
            '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
          )}
          ${renderIconButton(
            "btn-stats",
            "Statistics",
            '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
          )}
        </div>
      </header>

      <div class="daily-clue-row">${renderClue()}</div>

      <section class="daily-board" aria-label="Guesses">
        ${renderRows()}
      </section>

      ${renderStatus()}
      ${renderActions()}

      <p class="daily-next">Next puzzle in <strong data-countdown>${formatCountdown(msUntilNextDay())}</strong></p>
    </main>
    ${renderPicker()}
    ${renderDialog()}
  `;
  bindEvents();
}

function bindEvents() {
  document.getElementById("btn-help")?.addEventListener("click", () => openDialog("help"));
  document.getElementById("btn-stats")?.addEventListener("click", () => openDialog("stats"));
  document.getElementById("btn-stats-inline")?.addEventListener("click", () => openDialog("stats"));
  document.getElementById("btn-close-dialog")?.addEventListener("click", () => openDialog(null));
  document.getElementById("daily-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) openDialog(null);
  });
  for (const id of ["btn-share", "btn-share-dialog"]) {
    document.getElementById(id)?.addEventListener("click", () => void copyShare());
  }
  document.getElementById("btn-clue")?.addEventListener("click", revealClue);
  document.getElementById("btn-guess")?.addEventListener("click", submitGuess);
  document.getElementById("btn-clear-draft")?.addEventListener("click", clearDraft);

  document.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
    const open = () => openPicker(Number(el.dataset.slot));
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });

  document.getElementById("picker-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePicker();
  });
  document.getElementById("btn-close-picker")?.addEventListener("click", closePicker);
  document.getElementById("btn-clear-pick")?.addEventListener("click", () => pickCard(null));
  document.querySelectorAll<HTMLButtonElement>("[data-pick-card]").forEach((btn) => {
    btn.addEventListener("click", () => pickCard(Number(btn.dataset.pickCard)));
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.pickingSlot !== null) closePicker();
    else if (state.dialog) openDialog(null);
    return;
  }
  if (
    e.key === "Enter" &&
    state.pickingSlot === null &&
    state.dialog === null &&
    !(e.target instanceof HTMLElement && e.target.closest("[data-slot], button"))
  ) {
    submitGuess();
  }
});

window.setInterval(() => {
  if (dayKey() !== state.puzzle.day) {
    Object.assign(state, freshState(), { dialog: state.dialog });
    render();
    return;
  }
  const text = formatCountdown(msUntilNextDay());
  document.querySelectorAll<HTMLElement>("[data-countdown]").forEach((el) => {
    el.textContent = text;
  });
}, 1000);

if (shouldShowHelpOnce()) state.dialog = "help";
render();
