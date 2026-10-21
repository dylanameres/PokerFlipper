export interface CardRain {
  setVisible(visible: boolean): void;
}

interface DropLayout {
  x: number;
  depth: number;
  durationS: number;
  delayS: number;
  drift: number;
  rot0: number;
  rot1: number;
}

function between(min: number, max: number, rand: () => number): number {
  return min + (max - min) * rand();
}

/** Spread drops evenly across the width (jittered) so no column is left empty. */
export function layoutDrops(count: number, rand: () => number = Math.random): DropLayout[] {
  return Array.from({ length: count }, (_, i) => {
    const depth = rand();
    // Far cards fall slower, like they're further back in the stream.
    const durationS = 26 - 10 * depth + between(-2, 2, rand);
    const rot0 = between(-40, 40, rand);
    return {
      x: ((i + between(0.1, 0.9, rand)) / count) * 100,
      depth,
      durationS,
      // Negative delays start every drop mid-fall so the screen is full on load.
      delayS: -between(0, durationS, rand),
      drift: between(-6, 6, rand),
      rot0,
      rot1: rot0 + between(-160, 160, rand),
    };
  });
}

function dropCount(): number {
  return Math.round(Math.min(34, Math.max(14, window.innerWidth / 42)));
}

/**
 * Background "waterfall" of cards. Built once and only shown/hidden afterwards,
 * so app re-renders don't restart the animation.
 */
export function createCardRain(renderCardHtml: (index: number) => string): CardRain {
  let el: HTMLElement | null = null;

  function build(): HTMLElement {
    const layer = document.createElement("div");
    layer.className = "card-rain";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = layoutDrops(dropCount())
      .map((d, i) => {
        const style = [
          `--x: ${d.x.toFixed(2)}%`,
          `--depth: ${d.depth.toFixed(3)}`,
          `--dur: ${d.durationS.toFixed(2)}s`,
          `--delay: ${d.delayS.toFixed(2)}s`,
          `--drift: ${d.drift.toFixed(2)}vw`,
          `--rot0: ${d.rot0.toFixed(1)}deg`,
          `--rot1: ${d.rot1.toFixed(1)}deg`,
        ].join("; ");
        return `<div class="card-rain__drop" style="${style}">${renderCardHtml(i)}</div>`;
      })
      .join("");
    document.body.prepend(layer);
    return layer;
  }

  return {
    setVisible(visible) {
      if (visible && !el) el = build();
      if (el) el.hidden = !visible;
    },
  };
}
