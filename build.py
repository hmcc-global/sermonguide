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

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
TEMPLATE_DIR = ROOT / "templates"
STATIC_CSS = ROOT / "static" / "styles.css"
OUTPUT_DIR = ROOT / "output"
CACHE_DIR = CONTENT_DIR / ".cache"

SITE_TITLE = "Sermon Guides"
FOOTER_BRAND = "HMCC"

# ESV API (https://api.esv.org). Set ESV_API_KEY to fetch passages by reference;
# without it we fall back to text already in the YAML.
ESV_API_KEY = os.environ.get("ESV_API_KEY", "").strip()
ESV_TEXT_URL = "https://api.esv.org/v3/passage/text/"
ESV_PARAMS = {
    "include-passage-references": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "true",
    "include-footnotes": "false",
    "include-headings": "false",
    "include-short-copyright": "false",
    "include-passage-horizontal-lines": "false",
    "include-heading-horizontal-lines": "false",
    "indent-poetry": "false",
    "line-length": "0",
}

_VERSE_RE = re.compile(r"\^(\d+)")
# ESV returns verse markers as "[26]"; rewrite to our own "^26" convention.
_ESV_VERSE_RE = re.compile(r"\[(\d+)\]\s*")


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


def _cache_path(reference: str) -> Path:
    """Stable, filesystem-safe cache filename for a passage reference."""
    safe = re.sub(r"[^A-Za-z0-9]+", "-", reference).strip("-").lower()
    return CACHE_DIR / f"{safe}.json"


def _parse_esv(passage: str) -> list[str]:
    """Split ESV plain text into paragraphs and convert verse markers."""
    paragraphs = []
    for chunk in re.split(r"\n\s*\n", passage.strip()):
        # Collapse intra-paragraph newlines; HTML would collapse them anyway.
        text = re.sub(r"\s*\n\s*", " ", chunk.strip())
        text = _ESV_VERSE_RE.sub(r"^\1 ", text).strip()
        if text:
            paragraphs.append(text)
    return paragraphs


def fetch_passage(reference: str) -> list[str] | None:
    """Return the ESV passage for a reference, using a disk cache.

    Reads from content/.cache first (so builds work offline and without a key
    once warmed). On a miss, fetches from the ESV API when ESV_API_KEY is set
    and writes the result back to the cache. Returns None if it cannot resolve
    the passage, letting the caller fall back to YAML text.
    """
    cache_file = _cache_path(reference)
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))["passages"]
        except (ValueError, KeyError):
            pass  # corrupt cache entry — refetch below

    if not ESV_API_KEY:
        return None

    query = urllib.parse.urlencode({**ESV_PARAMS, "q": reference})
    request = urllib.request.Request(
        f"{ESV_TEXT_URL}?{query}",
        headers={"Authorization": f"Token {ESV_API_KEY}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError) as exc:
        print(f"  warning: ESV fetch failed for {reference!r}: {exc}")
        return None

    passages = _parse_esv("\n\n".join(payload.get("passages", [])))
    if not passages:
        print(f"  warning: ESV returned no text for {reference!r}")
        return None

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(
            {"reference": payload.get("canonical", reference), "passages": passages},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"  fetched ESV passage {payload.get('canonical', reference)!r}")
    return passages


def load_guide(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    data["slug"] = path.stem
    data.setdefault("footer_brand", FOOTER_BRAND)

    # Resolve scripture from the ESV API (by reference) when possible, otherwise
    # keep whatever text is already in the YAML.
    reference = data.get("scripture_ref") or data.get("scripture_title")
    if reference:
        fetched = fetch_passage(reference)
        if fetched:
            data["scripture_passage"] = fetched
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

    # Ordering: an explicit `order` field wins (0 = newest), otherwise fall back
    # to `date` (newest first). Two stable sorts compose these rules.
    guides.sort(key=lambda g: str(g.get("date", "")), reverse=True)
    guides.sort(key=lambda g: g.get("order", 10**9))

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
