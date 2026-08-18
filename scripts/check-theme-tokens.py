#!/usr/bin/env python3
"""Keep the two dark-theme blocks in tokens.css in sync with each other.

Dark mode is reachable two ways: the in-app toggle sets :root[data-theme="dark"], and a
system preference matches the prefers-color-scheme block. CSS has no way to share one
declaration list between them, so they are written twice. A token defined in only one of
them silently falls back to its light value down that one path, which is how the chart
grid ended up painting near-white lines over a dark canvas.
"""
import re
import sys
from pathlib import Path

TOKENS = Path(__file__).resolve().parent.parent / "tethysapp/ngiab/public/frontend/styles/tokens.css"


def declared(css, selector):
    """Return the custom-property names declared in the first block matching `selector`."""
    start = css.index(selector) + len(selector)
    body = css[start : css.index("}", start)]
    return set(re.findall(r"(--[a-z0-9-]+)\s*:", body))


def main():
    css = TOKENS.read_text()
    try:
        toggle = declared(css, ':root[data-theme="dark"] {')
        system = declared(css, ':root:not([data-theme="light"]) {')
    except ValueError:
        print(f"{TOKENS}: could not find both dark-theme blocks", file=sys.stderr)
        return 1

    failures = []
    for name, missing in (("toggle", system - toggle), ("system", toggle - system)):
        if missing:
            failures.append(f"  the {name} dark block is missing: {', '.join(sorted(missing))}")
    if failures:
        print(f"{TOKENS}: dark-theme blocks disagree", file=sys.stderr)
        print("\n".join(failures), file=sys.stderr)
        return 1

    print(f"tokens.css: both dark blocks define the same {len(toggle)} tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
