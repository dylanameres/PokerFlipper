"""Generate src/assets/zomba-rosette.svg (the "zomba" card back).

The Zomba rim is a rosette of circles: CIRCLES equal circles, each passing
through the center, spaced evenly around it. Their arcs cross in both
directions, so the white strokes form a lattice of diamond cells that shrink
toward the center, and the outer edge is scalloped.

Run: python3 scripts/gen-zomba-rosette.py
"""

from pathlib import Path

CIRCLES = 26
STROKE = 2.4  # white lattice line width at the rim (viewBox units)
GLOW = 4.0  # soft halo drawn under each line
BANDS = 12  # rings the line width steps across
R = 50  # viewBox half-size; the rosette's outer edge touches it

OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "zomba-rosette.svg"


def main() -> None:
    r = R / 2
    uses = "".join(
        f'<use href="#c" transform="rotate({i * 360 / CIRCLES:g})"/>' for i in range(CIRCLES)
    )
    # Cells shrink toward the center, so lines must too or they merge into a blob.
    clips, glow, lines = [], [], []
    for b in range(BANDS):
        inner, outer = R * b / BANDS, R * (b + 1) / BANDS
        scale = max(((inner + outer) / 2 / R) ** 0.85, 0.12)
        ring = f"M{outer:g} 0A{outer:g} {outer:g} 0 1 0 -{outer:g} 0A{outer:g} {outer:g} 0 1 0 {outer:g} 0Z"
        if inner:
            ring += f"M{inner:g} 0A{inner:g} {inner:g} 0 1 1 -{inner:g} 0A{inner:g} {inner:g} 0 1 1 {inner:g} 0Z"
        clips.append(f'<clipPath id="b{b}"><path fill-rule="evenodd" d="{ring}"/></clipPath>')
        glow.append(f'<g clip-path="url(#b{b})" stroke-width="{GLOW * scale:.2f}"><use href="#all"/></g>')
        lines.append(f'<g clip-path="url(#b{b})" stroke-width="{STROKE * scale:.2f}"><use href="#all"/></g>')
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="-{R} -{R} {2 * R} {2 * R}">
<defs>
<radialGradient id="cell"><stop offset="0" stop-color="#c4c8ce"/><stop offset=".5" stop-color="#9da2a9"/><stop offset="1" stop-color="#90959c"/></radialGradient>
<radialGradient id="core"><stop offset="0" stop-color="#fff"/><stop offset=".05" stop-color="#fff" stop-opacity=".8"/><stop offset=".18" stop-color="#fff" stop-opacity="0"/></radialGradient>
<circle id="c" cx="{r:g}" r="{r:g}"/>
<g id="all">{uses}</g>
{"".join(clips)}
</defs>
<circle r="{R}" fill="url(#cell)"/>
<g fill="none" stroke="#fff" stroke-opacity=".45">{"".join(glow)}</g>
<g fill="none" stroke="#fff">{"".join(lines)}</g>
<circle r="{R}" fill="url(#core)"/>
</svg>
"""
    OUT.write_text(svg)
    print(f"wrote {OUT} ({len(svg)} bytes)")


if __name__ == "__main__":
    main()
