#!/usr/bin/env python3
"""Assert the two reader stylesheets haven't drifted apart.

static/styles.css (inlined by build.py into the Jinja-built site) and
studio/app/(site)/site.css (imported by the Next port) render the same pages
and must stay identical. They differ in exactly two sanctioned ways:

  1. the leading comment block, and
  2. the --display / --body font families — the Jinja site names the Google
     Fonts families directly, the Next app points at next/font CSS variables.

Everything else being equal is what keeps a responsive fix from landing on one
surface and silently missing the other.

Run with --fix to regenerate site.css from styles.css instead of just checking.
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_CSS = ROOT / "static" / "styles.css"
SITE_CSS = ROOT / "studio" / "app" / "(site)" / "site.css"

SITE_HEADER = """/* Sermon Guide styling — ported verbatim from static/styles.css.
   Only the two font variables differ: they point at the self-hosted
   next/font families (--font-bebas / --font-inter) instead of a Google
   Fonts <link>. This stylesheet is code-split to the (site) routes only,
   so its :root variables never collide with the studio's. */"""

STATIC_FONTS = (
    '  --display: "Bebas Neue", "Oswald", Impact, sans-serif;\n'
    '  --body: "Inter", "Helvetica Neue", Arial, sans-serif;'
)
SITE_FONTS = (
    '  --display: var(--font-bebas), "Oswald", Impact, sans-serif;\n'
    '  --body: var(--font-inter), "Helvetica Neue", Arial, sans-serif;'
)

LEADING_COMMENT = re.compile(r"\A/\*.*?\*/", re.S)


def render_site_css(static_css: str) -> str:
    """Produce the expected site.css from styles.css."""
    if not LEADING_COMMENT.match(static_css):
        sys.exit(f"{STATIC_CSS}: expected a leading /* ... */ comment block")
    out = LEADING_COMMENT.sub(lambda _: SITE_HEADER, static_css, count=1)
    if STATIC_FONTS not in out:
        sys.exit(
            f"{STATIC_CSS}: could not find the --display/--body declarations to "
            f"substitute. If the font stack changed, update STATIC_FONTS/SITE_FONTS "
            f"in {Path(__file__).name}."
        )
    return out.replace(STATIC_FONTS, SITE_FONTS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fix",
        action="store_true",
        help="rewrite site.css from styles.css instead of failing",
    )
    args = parser.parse_args()

    for path in (STATIC_CSS, SITE_CSS):
        if not path.is_file():
            sys.exit(f"missing: {path}")

    expected = render_site_css(STATIC_CSS.read_text(encoding="utf-8"))
    actual = SITE_CSS.read_text(encoding="utf-8")

    if expected == actual:
        print(f"CSS twins in sync ({len(actual.splitlines())} lines).")
        return 0

    if args.fix:
        SITE_CSS.write_text(expected, encoding="utf-8")
        print(f"Regenerated {SITE_CSS.relative_to(ROOT)} from {STATIC_CSS.relative_to(ROOT)}.")
        return 0

    diff = difflib.unified_diff(
        actual.splitlines(keepends=True),
        expected.splitlines(keepends=True),
        fromfile=f"{SITE_CSS.relative_to(ROOT)} (actual)",
        tofile=f"{SITE_CSS.relative_to(ROOT)} (expected from styles.css)",
    )
    sys.stderr.writelines(diff)
    sys.stderr.write(
        "\nThe two reader stylesheets have drifted. A change to one must be made "
        "to the other.\nRun:  python scripts/check_css_sync.py --fix\n"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
