import { simulateHand } from "./poker";

function parseCards(raw: string): string[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

const form = document.getElementById("sim-form") as HTMLFormElement;
const out = document.getElementById("out") as HTMLPreElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const runBtn = document.getElementById("run") as HTMLButtonElement;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  out.hidden = true;

  const hero = parseCards((document.getElementById("hero") as HTMLInputElement).value);
  const villainRaw = (document.getElementById("villain") as HTMLInputElement).value;
  const villain = parseCards(villainRaw);
  const board = parseCards((document.getElementById("board") as HTMLInputElement).value);
  const iterations = Number(
    (document.getElementById("iterations") as HTMLInputElement).value,
  );

  if (hero.length !== 2) {
    showError("Hero needs exactly 2 cards (e.g. As Ah).");
    return;
  }
  if (villain.length !== 0 && villain.length !== 2) {
    showError("Villain needs 0 or 2 cards.");
    return;
  }
  if (board.length > 5) {
    showError("Board can have at most 5 cards.");
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = "Running…";

  // Yield so the button label updates before the sync simulation runs.
  setTimeout(() => {
    try {
      const result = simulateHand({
        hands: [hero, villain],
        board,
        iterations,
      });

      const [heroEq, villEq] = result.equities;
      const lines = [
        `Hero    ${hero.join(" ").padEnd(8)}  ${heroEq.toFixed(1)}% equity`,
        `Villain ${(villain.length ? villain.join(" ") : "(random)").padEnd(8)}  ${villEq.toFixed(1)}% equity`,
        "",
        `${result.iterations.toLocaleString()} iterations`,
        board.length ? `Board: ${board.join(" ")}` : "Board: (full runout)",
      ];
      out.textContent = lines.join("\n");
      out.hidden = false;
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Simulate";
    }
  }, 10);
});

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}
