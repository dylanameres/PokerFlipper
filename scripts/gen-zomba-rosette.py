"""Generate src/assets/zomba-rosette.svg (the "zomba" card back).

The rosette is a checkerboard laid out on a log-polar grid: cell edges follow
two mirrored families of logarithmic spirals, so cells shrink toward the center.
TWIST shears angle by log-radius to give the pattern its swirl.

Run: python3 scripts/gen-zomba-rosette.py
"""

import math
from pathlib import Path

ARMS = 20  # spirals per direction
TWIST = 0.3
GAP = 0.08  # fraction of a cell left white on each side
EDGE_STEPS = 3  # points per cell edge (cells are curved)
R = 50  # viewBox half-size
R_MAX = 1.45  # cover the square's corners
R_MIN = 0.02

D = 2 * math.pi / ARMS
OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "zomba-rosette.svg"


def point(a: float, b: float) -> tuple[float, float]:
    u = (a - b) * D / 2
    theta = (a + b) * D / 2 + TWIST * u
    r = R * math.exp(u)
    return r * math.cos(theta), r * math.sin(theta)


def cell_outline() -> list[tuple[float, float]]:
    lo, hi = GAP, 1 - GAP
    t = [lo + (hi - lo) * i / EDGE_STEPS for i in range(EDGE_STEPS + 1)]
    return (
        [(x, lo) for x in t]
        + [(hi, y) for y in t[1:]]
        + [(x, hi) for x in reversed(t[:-1])]
        + [(lo, y) for y in reversed(t[1:-1])]
    )


def main() -> None:
    outline = cell_outline()
    paths = []
    k_min = math.floor(2 * math.log(R_MIN) / D) - 1
    k_max = math.ceil(2 * math.log(R_MAX) / D) + 1
    for k in range(k_min, k_max):
        for s in range(0, 2 * ARMS, 2):
            if (k + s) % 2:
                continue
            a0, b0 = (s + k) // 2, (s - k) // 2
            pts = [point(a0 + x, b0 + y) for x, y in outline]
            paths.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z")

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="-{R} -{R} {2 * R} {2 * R}">
<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset=".12" stop-color="#fff" stop-opacity=".85"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect x="-{R}" y="-{R}" width="{2 * R}" height="{2 * R}" fill="#f7f9fc"/>
<path fill="#aeb6c2" d="{''.join(paths)}"/>
<circle r="{R}" fill="url(#g)"/>
</svg>
"""
    OUT.write_text(svg)
    print(f"wrote {OUT} ({len(paths)} cells, {len(svg)} bytes)")


if __name__ == "__main__":
    main()
