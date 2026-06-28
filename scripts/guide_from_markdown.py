#!/usr/bin/env python3
"""Turn a pasted markdown sermon guide into a content/<slug>.yaml file.

Used by the "new guide" GitHub Issue workflow: a non-developer pastes the guide
in a known markdown shape (see docs/ADD-A-GUIDE.md / the issue form), and this
script parses it into the YAML schema build.py expects.

Input comes from the GUIDE_MARKDOWN env var (or stdin). An optional SLUG env var
overrides the auto-derived filename. On success it writes the file and prints the
slug to stdout.

The expected markdown:

    # SERIES — Part N: Subtitle
    Date: 2026-06-22
    Scripture: Luke 1:46-55

    ## Recap
    First paragraph...

    Second paragraph...

    ## One Thing
    The single takeaway.

    ## Discussion Questions
    ### Connecting
    - Question one?
    ### Committing
    - Question two?

    ## Next Steps
    - First step.
    - Second step.

Only the title line and at least one other section are required; everything else
degrades gracefully.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONTENT_DIR = ROOT / "content"

# Date formats authors realistically paste. We normalize all of them to ISO
# (YYYY-MM-DD), which build.py expects for display and date-based sorting.
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%m/%d/%Y", "%m/%d/%y",
    "%B %d, %Y", "%b %d, %Y",
    "%B %d %Y", "%b %d %Y",
    "%d %B %Y", "%d %b %Y",
)


def normalize_date(value: str) -> str:
    """Coerce a written date into ISO YYYY-MM-DD, or return it unchanged.

    Authors paste dates as "2026-06-28", "June 28, 2026", "6/28/2026", etc.
    We recognize the common shapes; anything we can't parse passes through so
    nothing is silently dropped.
    """
    raw = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return raw


def slugify(text: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return slug or "guide"


def split_title(title: str) -> tuple[str, str]:
    """Split "SERIES — Part N: Subtitle" into (series, part)."""
    # Accept em dash, en dash, or " - " as the series/part separator.
    parts = re.split(r"\s+[—–-]\s+", title, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return title.strip(), ""


def paragraphs(block: str) -> list[str]:
    """Split a text block into paragraphs on blank lines."""
    out = []
    for chunk in re.split(r"\n\s*\n", block.strip()):
        text = re.sub(r"\s+", " ", chunk.strip())
        if text:
            out.append(text)
    return out


def list_items(block: str) -> list[str]:
    """Pull "- " bullet lines out of a block."""
    items = []
    for line in block.splitlines():
        m = re.match(r"\s*[-*]\s+(.*)", line)
        if m and m.group(1).strip():
            items.append(m.group(1).strip())
    return items


def sections(body: str) -> dict[str, str]:
    """Map each '## Heading' to the text beneath it (case-insensitive keys)."""
    result: dict[str, str] = {}
    current = None
    buf: list[str] = []
    for line in body.splitlines():
        m = re.match(r"##\s+(.*)", line)
        if m and not line.startswith("###"):
            if current is not None:
                result[current] = "\n".join(buf).strip()
            current = m.group(1).strip().lower()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        result[current] = "\n".join(buf).strip()
    return result


def subsections(block: str) -> dict[str, list[str]]:
    """Map each '### Category' to its bullet list, preserving order."""
    result: dict[str, list[str]] = {}
    current = None
    buf: list[str] = []
    for line in block.splitlines():
        m = re.match(r"###\s+(.*)", line)
        if m:
            if current is not None:
                result[current] = list_items("\n".join(buf))
            current = m.group(1).strip()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        result[current] = list_items("\n".join(buf))
    return {k: v for k, v in result.items() if v}


# The four HMCC discussion-question categories, in their intended flow:
# connect, examine the text, let it convict, then act. Authors may paste them
# in any order; we normalize to this sequence. Unknown categories are kept and
# appended in the order they were written.
CATEGORY_ORDER = ["Connecting", "Considering", "Confessing", "Committing"]


def order_categories(dq: dict[str, list[str]]) -> dict[str, list[str]]:
    """Sort discussion-question categories into the canonical HMCC order."""
    rank = {name.lower(): i for i, name in enumerate(CATEGORY_ORDER)}
    return dict(sorted(dq.items(), key=lambda kv: rank.get(kv[0].lower(), len(rank))))


def unwrap_issue_form(body: str) -> str:
    """Strip the GitHub issue-form wrapper around the pasted guide, if present.

    A single-textarea form renders the field under a '### Guide content' header.
    The guide's own headers come after it, so we keep everything past the first
    occurrence. Also drops HTML comments and the form's '_No response_' marker.
    """
    text = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
    marker = re.search(r"^###\s+Guide content\s*$", text, flags=re.MULTILINE | re.IGNORECASE)
    if marker:
        text = text[marker.end():]
    text = re.sub(r"^\s*_No response_\s*$", "", text, flags=re.MULTILINE)
    return text


def parse(markdown: str) -> dict:
    text = unwrap_issue_form(markdown).replace("\r\n", "\n").strip()
    if not text:
        raise ValueError("No content was provided.")

    title_match = re.search(r"^#\s+(.*)$", text, flags=re.MULTILINE)
    if not title_match:
        raise ValueError(
            "Couldn't find the title line. The first line should start with "
            "'# ' — for example: '# ADORE — Part 5: Worship With Joy'."
        )
    series, part = split_title(title_match.group(1))

    # Header lines (Date:, Scripture:) live between the title and the first '## '.
    header_zone = text[title_match.end():]
    first_section = re.search(r"^##\s+", header_zone, flags=re.MULTILINE)
    header_text = header_zone[: first_section.start()] if first_section else header_zone

    def header_field(name: str) -> str:
        # Tolerate markdown emphasis the author may have wrapped the label in,
        # e.g. "**Date:** ...", "*Scripture*: ...", "__Preacher__: ...". The
        # markers can sit before the label, between the label and the colon, or
        # right after the colon, so we allow them in each spot and trim any that
        # trail the value.
        m = re.search(
            rf"^\s*[*_]*\s*{name}\s*[*_]*\s*:\s*[*_]*\s*(.+?)\s*[*_]*$",
            header_text,
            flags=re.MULTILINE | re.IGNORECASE,
        )
        return m.group(1).strip() if m else ""

    secs = sections(text)

    guide: dict = {"series": series}
    if part:
        guide["part"] = part
    # Always emit a date. build.py derives its `legacy_layout` flag from the
    # presence of `date:` — guides without one render the old layout — so a
    # form guide must carry a date. Default to today when none was given.
    guide["date"] = normalize_date(header_field("date")) or date.today().isoformat()

    scripture = header_field("scripture")
    scripture_ref = header_field("scripture ref") or header_field("scripture reference")
    if scripture:
        guide["scripture_title"] = scripture
    if scripture_ref and scripture_ref != scripture:
        guide["scripture_ref"] = scripture_ref

    preacher = header_field("preacher")
    if preacher:
        guide["preacher"] = preacher

    if "recap" in secs:
        guide["recap"] = paragraphs(secs["recap"])
    if secs.get("one thing"):
        guide["one_thing"] = re.sub(r"\s+", " ", secs["one thing"]).strip()

    dq = subsections(secs.get("discussion questions", ""))
    if dq:
        guide["discussion_questions"] = order_categories(dq)

    if "next steps" in secs:
        steps = list_items(secs["next steps"])
        if steps:
            guide["next_steps"] = steps

    return guide


def main() -> None:
    markdown = os.environ.get("GUIDE_MARKDOWN")
    if markdown is None:
        markdown = sys.stdin.read()

    guide = parse(markdown)

    slug_override = os.environ.get("SLUG", "").strip()
    if slug_override:
        slug = slugify(slug_override)
    else:
        base = f"{guide['series']} {guide.get('part', '')}".strip()
        slug = slugify(base)

    CONTENT_DIR.mkdir(exist_ok=True)
    out = CONTENT_DIR / f"{slug}.yaml"
    out.write_text(
        yaml.safe_dump(guide, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )
    print(slug)


if __name__ == "__main__":
    main()
