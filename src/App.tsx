import { useMemo, useState } from "react";
import { CardPicker } from "./components/CardPicker";
import { type Card } from "./poker/cards";
import { HAND_CATEGORY_NAMES, HandCategory } from "./poker/evaluator";
import { simulate, type SimulationResult } from "./poker/simulate";
import { classifyStartingHand } from "./poker/strategy";

type Slots = (Card | null)[];

const emptyHole: Slots = [null, null];
const emptyBoard: Slots = [null, null, null, null, null];

function nonNull(slots: Slots): Card[] {
  return slots.filter((c): c is Card => c !== null);
}

export function App() {
  const [hero, setHero] = useState<Slots>(emptyHole);
  const [villain, setVillain] = useState<Slots>(emptyHole);
  const [board, setBoard] = useState<Slots>(emptyBoard);
  const [iterations, setIterations] = useState(50000);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);

  const usedCards = useMemo(() => {
    const set = new Set<Card>();
    for (const c of nonNull(hero)) set.add(c);
    for (const c of nonNull(villain)) set.add(c);
    for (const c of nonNull(board)) set.add(c);
    return set;
  }, [hero, villain, board]);

  const heroAdvice = classifyStartingHand(nonNull(hero));

  const canRun = nonNull(hero).length === 2;

  const run = () => {
    setRunning(true);
    setResult(null);
    // Defer so the button shows its disabled/running state before the
    // (synchronous) simulation blocks the main thread.
    setTimeout(() => {
      const res = simulate({
        players: [{ hole: nonNull(hero) }, { hole: nonNull(villain) }],
        board: nonNull(board),
        iterations,
      });
      setResult(res);
      setRunning(false);
    }, 20);
  };

  const reset = () => {
    setHero(emptyHole);
    setVillain(emptyHole);
    setBoard(emptyBoard);
    setResult(null);
  };

  const playerLabels = ["Hero", "Villain"];

  return (
    <div className="app">
      <header className="hero">
        <h1>
          Poker<span className="chip">Flipper</span>
        </h1>
        <p>Simulate Texas Hold'em hands and learn the strategy behind them.</p>
      </header>

      <div className="grid">
        <section className="panel">
          <h2>Hero hand</h2>
          <CardPicker
            title="Hero"
            cards={hero}
            usedCards={usedCards}
            onChange={setHero}
          />
          {heroAdvice && (
            <div className="advice">
              <div className="tier">
                {heroAdvice.tier} &middot; {heroAdvice.label}
              </div>
              <div>{heroAdvice.advice}</div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Villain hand</h2>
          <CardPicker
            title="Villain"
            cards={villain}
            usedCards={usedCards}
            onChange={setVillain}
          />
          <p className="hint">
            Leave empty to deal the villain a random hand each simulation.
          </p>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>Community board</h2>
        <CardPicker
          title="Board"
          cards={board}
          usedCards={usedCards}
          onChange={setBoard}
        />
        <p className="hint">
          Add flop / turn / river cards, or leave empty to run the full runout.
        </p>
      </section>

      <div className="controls">
        <label>
          Simulations
          <select
            value={iterations}
            onChange={(e) => setIterations(Number(e.target.value))}
          >
            <option value={10000}>10,000</option>
            <option value={50000}>50,000</option>
            <option value={100000}>100,000</option>
            <option value={250000}>250,000</option>
          </select>
        </label>
        <button className="primary" onClick={run} disabled={!canRun || running}>
          {running ? "Simulating\u2026" : "Run simulation"}
        </button>
        <button className="ghost" onClick={reset}>
          Reset
        </button>
        {!canRun && (
          <span className="hint">Pick both of the Hero's hole cards to start.</span>
        )}
      </div>

      {result && (
        <section className="panel results">
          <h2>
            Results
            <span className="hint">
              {result.iterations.toLocaleString()} simulations
            </span>
          </h2>
          {result.players.map((p, i) => (
            <div className="equity-row" key={i}>
              <div className="equity-head">
                <strong>{playerLabels[i]}</strong>
                <span className="pct">{p.equity.toFixed(1)}% equity</span>
              </div>
              <div className="bar">
                <div className="win" style={{ width: `${p.winPct}%` }} />
                <div className="tie" style={{ width: `${p.tiePct}%` }} />
                <div className="loss" style={{ width: `${p.lossPct}%` }} />
              </div>
              <div className="legend">
                <span>
                  <span className="dot" style={{ background: "var(--win)" }} />
                  Win {p.winPct.toFixed(1)}%
                </span>
                <span>
                  <span className="dot" style={{ background: "var(--tie)" }} />
                  Tie {p.tiePct.toFixed(1)}%
                </span>
                <span>
                  <span className="dot" style={{ background: "var(--loss)" }} />
                  Lose {p.lossPct.toFixed(1)}%
                </span>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                Most likely made hand:{" "}
                {mostLikelyCategory(p.categoryCounts)}
              </div>
            </div>
          ))}
        </section>
      )}

      <p className="footer-note">
        PokerFlipper runs Monte Carlo simulations entirely in your browser.
      </p>
    </div>
  );
}

function mostLikelyCategory(
  counts: Record<HandCategory, number>,
): string {
  let bestCat = HandCategory.HighCard;
  let bestCount = -1;
  (Object.keys(counts) as unknown as HandCategory[]).forEach((key) => {
    const cat = Number(key) as HandCategory;
    if (counts[cat] > bestCount) {
      bestCount = counts[cat];
      bestCat = cat;
    }
  });
  return HAND_CATEGORY_NAMES[bestCat];
}
