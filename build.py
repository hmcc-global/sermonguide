#!/usr/bin/env python3
"""Static site generator for HMCC sermon guides.

Reads YAML content files and renders self-contained HTML pages styled after
hmcc.net. No runtime services — just content in, HTML out.

Usage:
    python build.py                       # build every guide in content/
    python build.py content/foo.yaml ...  # build only the given file(s)

Output lands in output/ (one <slug>.html per guide, plus index.html).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
TEMPLATE_DIR = ROOT / "templates"
STATIC_CSS = ROOT / "static" / "styles.css"
OUTPUT_DIR = ROOT / "output"

SITE_TITLE = "Sermon Guides"
FOOTER_BRAND = "HMCC"

_VERSE_RE = re.compile(r"\^(\d+)")


def verses(text: str) -> Markup:
    """Turn ^N verse markers into small superscript verse numbers.

    The text is HTML-escaped first, so content stays safe; only the verse
    markup we add is treated as HTML.
    """
    escaped = str(escape(text))
    marked = _VERSE_RE.sub(r'<sup class="verse">\1</sup>', escaped)
    return Markup(marked)


def make_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["verses"] = verses
    return env


def load_guide(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    data["slug"] = path.stem
    data.setdefault("footer_brand", FOOTER_BRAND)
    return data


def build(paths: list[Path]) -> None:
    if not paths:
        print("No content files found in content/.")
        return

    env = make_env()
    css = STATIC_CSS.read_text(encoding="utf-8")
    guide_tpl = env.get_template("guide.html.j2")
    index_tpl = env.get_template("index.html.j2")

    OUTPUT_DIR.mkdir(exist_ok=True)

    # Always load EVERY guide so the index and prev/next links stay complete,
    # even when only a subset of pages is being (re)written.
    all_paths = sorted(CONTENT_DIR.glob("*.yaml")) + sorted(CONTENT_DIR.glob("*.yml"))
    guides = [load_guide(p) for p in all_paths]

    # Newest first when a date is present; undated guides sort last.
    guides.sort(key=lambda g: str(g.get("date", "")), reverse=True)

    # Give each guide its neighbors for in-page navigation.
    for i, guide in enumerate(guides):
        guide["newer"] = guides[i - 1] if i > 0 else None
        guide["older"] = guides[i + 1] if i < len(guides) - 1 else None

    write_slugs = {p.stem for p in paths}  # only (re)write the requested pages
    for guide in guides:
        if guide["slug"] not in write_slugs:
            continue
        html = guide_tpl.render(css=css, **guide)
        out = OUTPUT_DIR / f"{guide['slug']}.html"
        out.write_text(html, encoding="utf-8")
        print(f"  built  {out.relative_to(ROOT)}")

    index_html = index_tpl.render(
        css=css,
        site_title=SITE_TITLE,
        footer_brand=FOOTER_BRAND,
        guides=guides,
    )
    (OUTPUT_DIR / "index.html").write_text(index_html, encoding="utf-8")
    print(f"  built  {(OUTPUT_DIR / 'index.html').relative_to(ROOT)}")
    print(f"\nDone — {len(write_slugs)} page(s) written, "
          f"{len(guides)} guide(s) on the index.")


def main() -> None:
    args = sys.argv[1:]
    if args:
        paths = [Path(a) for a in args]
        missing = [p for p in paths if not p.exists()]
        if missing:
            sys.exit(f"File(s) not found: {', '.join(str(m) for m in missing)}")
    else:
        paths = sorted(CONTENT_DIR.glob("*.yaml")) + sorted(CONTENT_DIR.glob("*.yml"))
    build(paths)


if __name__ == "__main__":
    main()
