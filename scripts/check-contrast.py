#!/usr/bin/env python3
"""Hold every text colour in tokens.css to its contrast floor, in both themes.

DESIGN.md claimed every semantic role was solved to at least 5:1. Its table listed four
roles and omitted --fg-subtle, which sat at 4.13:1 against --surface -- below the 4.5:1 AA
floor, on the smallest text in the interface. The claim was what made it invisible, so the
claim is checked here instead of written down.

Parses the OKLCH values straight out of tokens.css, converts to sRGB, and applies the WCAG
relative-luminance formula. No dependencies: the conversion is short enough to state, and
adding a colour library to a build-less project to check four numbers is a poor trade.
"""

import math
import re
import sys
from pathlib import Path

TOKENS = Path(__file__).resolve().parent.parent / "tethysapp/ngiab/public/frontend/styles/tokens.css"

# Text roles and the surface each is drawn on. --fg-subtle is here because it was missing.
PAIRS = (
    ("--fg", "--surface", 4.5),
    ("--fg-muted", "--surface", 4.5),
    ("--fg-subtle", "--surface", 4.5),
    ("--accent", "--surface", 4.5),
    ("--danger", "--surface", 4.5),
    ("--warning", "--surface", 4.5),
)


def oklch_to_srgb(lightness, chroma, hue):
    """OKLCH to linear-light sRGB, clamped to gamut."""
    h = math.radians(hue)
    a, b = chroma * math.cos(h), chroma * math.sin(h)
    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def gamma(c):
        return 12.92 * c if c <= 0.0031308 else 1.055 * (max(c, 0) ** (1 / 2.4)) - 0.055

    return [min(max(gamma(x), 0), 1) for x in (r, g, bl)]


def luminance(rgb):
    def linear(v):
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def theme_blocks(css):
    """Return {theme name: {token: (L, C, H)}} for the light root and the toggled dark root."""
    themes = {}
    for name, selector in (("light", ":root {"), ("dark", ':root[data-theme="dark"] {')):
        start = css.index(selector) + len(selector)
        body = css[start : css.index("}", start)]
        found = re.findall(r"(--[a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)", body)
        themes[name] = {n: (float(a), float(b), float(c)) for n, a, b, c in found}
    # The dark block overrides the light one rather than restating every token.
    themes["dark"] = {**themes["light"], **themes["dark"]}
    return themes


def main():
    css = TOKENS.read_text()
    try:
        themes = theme_blocks(css)
    except ValueError:
        print(f"{TOKENS}: could not find both :root blocks", file=sys.stderr)
        return 1

    failures = []
    for theme, tokens in themes.items():
        for fg, bg, floor in PAIRS:
            if fg not in tokens or bg not in tokens:
                failures.append(f"  {theme}: {fg} on {bg} is not defined")
                continue
            ratio = contrast(oklch_to_srgb(*tokens[fg]), oklch_to_srgb(*tokens[bg]))
            mark = "ok " if ratio >= floor else "FAIL"
            print(f"  {mark} {theme:5s} {fg:12s} on {bg:10s} {ratio:5.2f}:1 (floor {floor})")
            if ratio < floor:
                failures.append(f"  {theme}: {fg} on {bg} is {ratio:.2f}:1, below {floor}")

    if failures:
        print("\ncontrast below the WCAG AA floor:", file=sys.stderr)
        print("\n".join(failures), file=sys.stderr)
        return 1

    print(f"contrast: {len(PAIRS) * len(themes)} role/theme pairs at or above their floor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
