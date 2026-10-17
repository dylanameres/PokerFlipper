"""Generate src/assets/treasure-back.svg (the "treasure" card back).

A mound of gold coins in a dark ship's hold, with a few trinkets (crown,
goblet, skull and crossbones, gems, pearl strand) and sparkles. Coins are scattered with a fixed
seed and drawn back-to-front so nearer coins overlap farther ones.

Run: python3 scripts/gen-treasure-back.py
"""

import math
import random
from pathlib import Path

W, H = 50, 70  # card aspect (cards are ~0.71 wide:tall)
SEED = 7
COINS = 150
OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "treasure-back.svg"


def mound_top(x: float) -> float:
    """Top edge of the pile: a soft hill peaking just left of center."""
    return 31 + 15 * ((x - 23) / 27) ** 2


def coins(rng: random.Random) -> list[tuple[float, str]]:
    items = []
    for _ in range(COINS):
        x = rng.uniform(-2, W + 2)
        top = mound_top(x)
        y = rng.uniform(top + 0.5, H + 2)
        depth = (y - 30) / 40  # 0 at the back, 1 at the front
        s = 0.7 + 0.45 * depth
        if rng.random() < 0.06:
            rot = rng.uniform(-35, 35)
            el = f'<use href="#edge" transform="translate({x:.1f} {y:.1f}) rotate({rot:.0f}) scale({s:.2f})"/>'
        else:
            rot = rng.uniform(-14, 14)
            el = f'<use href="#coin" transform="translate({x:.1f} {y:.1f}) rotate({rot:.0f}) scale({s:.2f})"/>'
        items.append((y, el))
    return items


def trinkets() -> list[tuple[float, str]]:
    crown = (
        '<g transform="translate(22 30.5)">'
        '<path d="M-6 2 L-6.5 -4 L-3.5 -1 L0 -5.5 L3.5 -1 L6.5 -4 L6 2 Z" fill="url(#gold)" stroke="#7a4d06" stroke-width=".4" stroke-linejoin="round"/>'
        '<rect x="-6.2" y="1.2" width="12.4" height="2.2" rx=".6" fill="url(#gold)" stroke="#7a4d06" stroke-width=".4"/>'
        '<circle cx="0" cy="2.3" r=".9" fill="#d81b3c"/><circle cx="-3.6" cy="2.3" r=".7" fill="#1f8f5a"/><circle cx="3.6" cy="2.3" r=".7" fill="#2a5bd7"/>'
        '<circle cx="-6.5" cy="-4" r=".6" fill="#fff3b0"/><circle cx="0" cy="-5.5" r=".6" fill="#fff3b0"/><circle cx="6.5" cy="-4" r=".6" fill="#fff3b0"/>'
        "</g>"
    )
    goblet = (
        '<g transform="translate(9.5 41) rotate(-8) scale(1.1)">'
        '<path d="M-3.4 -6 L3.4 -6 Q3.2 -1 0.7 0 L0.7 3 L2.4 4.2 L-2.4 4.2 L-0.7 3 L-0.7 0 Q-3.2 -1 -3.4 -6 Z" fill="url(#gold)" stroke="#7a4d06" stroke-width=".4" stroke-linejoin="round"/>'
        '<ellipse cx="0" cy="-6" rx="3.4" ry=".9" fill="#7a4d06"/>'
        '<circle cx="0" cy="-3" r=".8" fill="#d81b3c"/>'
        "</g>"
    )
    ruby = (
        '<g transform="translate(31 47) rotate(12) scale(1.45)">'
        '<path d="M-2.6 -1 L-1.4 -2.4 L1.4 -2.4 L2.6 -1 L0 2.6 Z" fill="#c0102e" stroke="#5e0414" stroke-width=".3" stroke-linejoin="round"/>'
        '<path d="M-2.6 -1 L2.6 -1 M-1.4 -2.4 L-0.8 -1 L0 2.6 L0.8 -1 L1.4 -2.4" fill="none" stroke="#ff6b85" stroke-width=".25"/>'
        "</g>"
    )
    emerald = (
        '<g transform="translate(15 56) rotate(-18) scale(1.35)">'
        '<path d="M-2.4 -1.6 L-1.6 -2.4 L1.6 -2.4 L2.4 -1.6 L2.4 1.6 L1.6 2.4 L-1.6 2.4 L-2.4 1.6 Z" fill="#14895a" stroke="#06402a" stroke-width=".3"/>'
        '<rect x="-1.3" y="-1.3" width="2.6" height="2.6" fill="#3fd598" fill-opacity=".55"/>'
        "</g>"
    )
    sapphire = (
        '<g transform="translate(41 62) scale(1.3)">'
        '<circle r="1.9" fill="#2349c4" stroke="#0d1f5c" stroke-width=".3"/>'
        '<circle cx="-.6" cy="-.6" r=".6" fill="#9db6ff" fill-opacity=".8"/>'
        "</g>"
    )
    pearls = []
    for i in range(16):
        t = i / 15
        x = 4 + 40 * t
        y = 50 + 7 * math.sin(math.pi * t) - 2.5 * t
        pearls.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r=".95" fill="url(#pearl)"/>')
    thread = "M" + " L".join(
        f"{4 + 40 * (i / 15):.1f} {50 + 7 * math.sin(math.pi * i / 15) - 2.5 * i / 15:.1f}" for i in range(16)
    )
    pearl_strand = (
        f'<g><path d="{thread}" fill="none" stroke="#6b5a3a" stroke-width=".25"/>' + "".join(pearls) + "</g>"
    )
    skull = (
        '<g transform="translate(41 39.5) rotate(10)">'
        '<path d="M-4.6 2.6 L4.6 -2.6 M-4.6 -2.6 L4.6 2.6" stroke="#efe6d2" stroke-width="1.5" stroke-linecap="round"/>'
        '<path d="M-3 .4 Q-3.2 -3.6 0 -3.7 Q3.2 -3.6 3 .4 Q2.4 1.4 1.6 1.6 L1.6 2.8 L-1.6 2.8 L-1.6 1.6 Q-2.4 1.4 -3 .4 Z" fill="#f4ecd8" stroke="#8a7d62" stroke-width=".3"/>'
        '<ellipse cx="-1.25" cy="-.9" rx=".9" ry="1" fill="#2a1a0a"/><ellipse cx="1.25" cy="-.9" rx=".9" ry="1" fill="#2a1a0a"/>'
        '<path d="M0 .3 L-.45 1.1 L.45 1.1 Z" fill="#2a1a0a"/>'
        '<path d="M-.8 1.8 L-.8 2.8 M0 1.8 L0 2.8 M.8 1.8 L.8 2.8" stroke="#8a7d62" stroke-width=".25"/>'
        "</g>"
    )
    return [
        (30.0, crown),
        (42.5, goblet),
        (47.0, ruby),
        (55.0, emerald),
        (41.5, skull),
        (63.5, pearl_strand),
        (61.0, sapphire),
    ]


def sparkles(rng: random.Random) -> str:
    out = []
    spots = [(22, 25), (31, 36), (12, 45), (40, 52), (26, 60), (6, 58), (44, 40)]
    for x, y in spots:
        s = rng.uniform(0.7, 1.2)
        out.append(f'<use href="#spark" transform="translate({x} {y}) scale({s:.2f})"/>')
    return "".join(out)


def main() -> None:
    rng = random.Random(SEED)
    layers = coins(rng) + trinkets()
    layers.sort(key=lambda t: t[0])
    mound = "M-1 {:.1f} ".format(mound_top(-1)) + " ".join(
        f"L{x} {mound_top(x):.1f}" for x in range(0, W + 2, 2)
    ) + f" L{W + 1} {H + 1} L-1 {H + 1} Z"
    planks = "".join(
        f'<rect x="{x}" y="0" width=".35" height="{H}" fill="#000" fill-opacity=".35"/>'
        for x in range(6, W, 8)
    )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">
<defs>
<radialGradient id="hold" cx="50%" cy="48%" r="70%"><stop offset="0" stop-color="#5a3816"/><stop offset=".55" stop-color="#2e1a0a"/><stop offset="1" stop-color="#120a04"/></radialGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#ffcc55" stop-opacity=".28"/><stop offset="1" stop-color="#ffcc55" stop-opacity="0"/></radialGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".45" stop-color="#f2c23a"/><stop offset="1" stop-color="#b07a12"/></linearGradient>
<linearGradient id="pile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c6a10"/><stop offset="1" stop-color="#4a2e05"/></linearGradient>
<radialGradient id="pearl" cx="35%" cy="35%"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e8e2d4"/><stop offset="1" stop-color="#a99f8c"/></radialGradient>
<g id="coin"><ellipse rx="4" ry="2.3" fill="url(#gold)" stroke="#7a4d06" stroke-width=".35"/><ellipse rx="2.7" ry="1.45" fill="none" stroke="#9c6a10" stroke-width=".3"/><path d="M-2.6 -.9 Q0 -1.9 2.6 -.9" fill="none" stroke="#fff6c8" stroke-width=".35" stroke-opacity=".8"/></g>
<g id="edge"><rect x="-1.1" y="-3" width="2.2" height="6" rx="1.1" fill="url(#gold)" stroke="#7a4d06" stroke-width=".35"/><path d="M-.3 -2.2 L-.3 2.2" stroke="#fff6c8" stroke-width=".3" stroke-opacity=".7"/></g>
<path id="spark" d="M0 -2 L.35 -.35 L2 0 L.35 .35 L0 2 L-.35 .35 L-2 0 L-.35 -.35 Z" fill="#fffbe0"/>
</defs>
<rect width="{W}" height="{H}" fill="url(#hold)"/>
{planks}
<ellipse cx="23" cy="30" rx="24" ry="16" fill="url(#glow)"/>
<path d="{mound}" fill="url(#pile)"/>
{"".join(el for _, el in layers)}
{sparkles(rng)}
</svg>
"""
    OUT.write_text(svg)
    print(f"wrote {OUT} ({len(svg)} bytes)")


if __name__ == "__main__":
    main()
