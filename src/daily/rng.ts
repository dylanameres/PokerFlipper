import { fullDeck, type Card } from "../poker";

export type Rng = () => number;

/** FNV-1a 32-bit hash, used to turn a day key into a seed. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: tiny deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngForDay(key: string, salt = "pokerflipper-daily"): Rng {
  return mulberry32(hashString(`${salt}:${key}`));
}

/** Fisher–Yates with an injected RNG; returns a new array. */
export function seededShuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function seededDeck(rng: Rng): Card[] {
  return seededShuffle(fullDeck(), rng);
}
