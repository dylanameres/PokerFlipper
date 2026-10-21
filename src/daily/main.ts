import { dayKey, formatCountdown, formatDayKey, msUntilNextDay } from "./calendar";
import { todaysPuzzle, type DailyPuzzle } from "./puzzle";
import {
  liveStreak,
  loadProgress,
  loadStats,
  winRate,
  type DailyProgress,
  type DailyStats,
} from "./stats";

type Dialog = "help" | "stats" | null;

interface DailyState {
  puzzle: DailyPuzzle;
  progress: DailyProgress;
  stats: DailyStats;
  dialog: Dialog;
  shareCopied: boolean;
}

const HELP_SEEN_KEY = "pokerflipper-daily-help-seen";

const root = document.getElementById("app")!;

function freshState(): DailyState {
  const puzzle = todaysPuzzle();
  return {
    puzzle,
    progress: loadProgress(puzzle.day),
    stats: loadStats(),
    dialog: null,
    shareCopied: false,
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

function shareText(): string {
  const { number } = state.puzzle;
  const outcome = state.progress.status === "won" ? "Solved" : "Busted";
  return `PokerFlipper Daily #${number} · ${outcome}\n${window.location.origin}/daily`;
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

function renderIconButton(id: string, label: string, path: string): string {
  return `<button type="button" class="btn btn--icon" id="${id}" aria-label="${label}" title="${label}">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>
  </button>`;
}

function renderBoard(): string {
  // Placeholder until the first game plugs in: today's seeded board, face down.
  const backs = Array.from(
    { length: 5 },
    () => `<div class="card card--back" data-card-back="blue" aria-hidden="true"></div>`,
  ).join("");
  return `
    <section class="daily-board" aria-label="Today's puzzle">
      <div class="daily-board__cards">${backs}</div>
      <p class="daily-board__note">Today's deal is shuffled and waiting. The first game is coming soon.</p>
    </section>
  `;
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
  return renderDialogShell(
    "daily-help-title",
    "How to play",
    `
      <div class="daily-help">
        <p>A new poker puzzle every day. Everyone gets the same deal.</p>
        <p>Solve it, keep your streak alive, and share your result with friends.</p>
        <p class="daily-help__muted">A new puzzle unlocks at midnight in your time zone.</p>
      </div>
    `,
  );
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
      <div class="daily-stats__footer">
        <div>
          <span class="daily-stats__label">Next puzzle</span>
          <strong class="daily-countdown" data-countdown>${formatCountdown(msUntilNextDay())}</strong>
        </div>
        <button type="button" class="btn btn--primary" id="btn-share" ${isFinished() ? "" : "disabled"}>
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

      ${renderBoard()}

      <p class="daily-next">Next puzzle in <strong data-countdown>${formatCountdown(msUntilNextDay())}</strong></p>
    </main>
    ${renderDialog()}
  `;
  bindEvents();
}

function openDialog(dialog: Dialog) {
  state.dialog = dialog;
  render();
}

function bindEvents() {
  document.getElementById("btn-help")?.addEventListener("click", () => openDialog("help"));
  document.getElementById("btn-stats")?.addEventListener("click", () => openDialog("stats"));
  document.getElementById("btn-close-dialog")?.addEventListener("click", () => openDialog(null));
  document.getElementById("daily-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) openDialog(null);
  });
  document.getElementById("btn-share")?.addEventListener("click", () => void copyShare());
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.dialog) openDialog(null);
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
