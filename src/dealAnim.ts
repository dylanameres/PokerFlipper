/** Deal fly-in animations from the table deck to hole / board slots. */

export type DealTarget = {
  key: string;
  /** Lower runs earlier (hole cards round-robin, then board left→right). */
  order: number;
};

let previousKeys = new Set<string>();
let runId = 0;

export function resetDealAnimationState() {
  previousKeys = new Set();
  runId += 1;
}

export function rememberDealKeys(keys: Iterable<string>) {
  previousKeys = new Set(keys);
}

export function newDealKeys(current: string[]): string[] {
  return current.filter((k) => !previousKeys.has(k));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Hide newly dealt cards, fly face-down ghosts from the deck, then reveal.
 * Call after the table DOM is in place.
 */
export function runDealAnimations(newKeys: string[]): void {
  if (newKeys.length === 0) return;

  const deck = document.getElementById("table-deck");
  const felt = document.querySelector(".felt");
  if (!deck || !felt) {
    revealAll(newKeys);
    return;
  }

  const targets = newKeys
    .map((key) => {
      const el = document.querySelector<HTMLElement>(`[data-deal-key="${key}"]`);
      return el ? { key, el, order: dealOrder(key) } : null;
    })
    .filter((t): t is { key: string; el: HTMLElement; order: number } => t !== null)
    .sort((a, b) => a.order - b.order);

  if (targets.length === 0) {
    // HTML may still have pending-deal from render — force visible.
    revealAll(newKeys);
    return;
  }

  if (prefersReducedMotion()) {
    for (const t of targets) reveal(t.el);
    return;
  }

  const myRun = ++runId;
  const deckRect = deck.getBoundingClientRect();
  const stagger = 70;
  const keysForRun = targets.map((t) => t.key);

  // Safety net: never leave cards invisible if a run is superseded or the tab sleeps.
  window.setTimeout(() => {
    if (myRun === runId) return;
    revealAll(keysForRun);
  }, stagger * targets.length + 800);

  targets.forEach((t, i) => {
    t.el.classList.add("card--pending-deal");
    window.setTimeout(() => {
      if (myRun !== runId) {
        // Superseded mid-stagger: still clear pending on the live DOM node for this key.
        revealAll([t.key]);
        return;
      }
      flyCard(deckRect, t.el, () => {
        // Always reveal this key — even if a newer run started during the flight.
        revealAll([t.key]);
      });
    }, i * stagger);
  });
}

function dealOrder(key: string): number {
  // h-seat-slot → deal by slot then seat (matches engine deal order)
  const hole = /^h-(\d+)-(\d+)$/.exec(key);
  if (hole) {
    const seat = Number(hole[1]);
    const slot = Number(hole[2]);
    return slot * 20 + seat;
  }
  const board = /^b-(\d+)$/.exec(key);
  if (board) return 1000 + Number(board[1]);
  return 9999;
}

function reveal(el: HTMLElement) {
  el.classList.remove("card--pending-deal");
  el.classList.add("card--dealt");
  window.setTimeout(() => el.classList.remove("card--dealt"), 280);
}

function revealAll(keys: string[]) {
  for (const key of keys) {
    const el = document.querySelector<HTMLElement>(`[data-deal-key="${key}"]`);
    if (el) reveal(el);
  }
}

/** Clear pending-deal on these keys if still hidden (background-tab / missed rAF). */
export function ensureDealKeysVisible(keys: string[]): void {
  revealAll(keys);
}

function flyCard(
  deckRect: DOMRect,
  target: HTMLElement,
  onDone: () => void,
) {
  const to = target.getBoundingClientRect();
  if (to.width < 2 || to.height < 2) {
    onDone();
    return;
  }

  const ghost = document.createElement("div");
  ghost.className = "card card--back card--flying";
  ghost.style.width = `${to.width}px`;
  ghost.style.height = `${to.height}px`;
  ghost.style.left = `${deckRect.left + deckRect.width / 2 - to.width / 2}px`;
  ghost.style.top = `${deckRect.top + deckRect.height / 2 - to.height / 2}px`;
  document.body.appendChild(ghost);

  const dx =
    to.left + to.width / 2 - (deckRect.left + deckRect.width / 2);
  const dy =
    to.top + to.height / 2 - (deckRect.top + deckRect.height / 2);

  const anim = ghost.animate(
    [
      {
        transform: "translate(0, 0) rotate(-12deg) scale(0.92)",
        offset: 0,
      },
      {
        transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) rotate(4deg) scale(1)`,
        offset: 0.55,
      },
      {
        transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)`,
        offset: 1,
      },
    ],
    {
      duration: 340,
      easing: "cubic-bezier(0.22, 0.8, 0.28, 1)",
      fill: "forwards",
    },
  );

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ghost.remove();
    onDone();
  };

  if (!anim || typeof anim.finished?.then !== "function") {
    finish();
    return;
  }

  // Tab background / WAAPI pause can stall `finished` — hard-cap so cards never stick.
  const watchdog = window.setTimeout(finish, 600);
  anim.finished.then(
    () => {
      window.clearTimeout(watchdog);
      finish();
    },
    () => {
      window.clearTimeout(watchdog);
      finish();
    },
  );
}
