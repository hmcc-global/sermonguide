# Sermon Guides

A tiny static-site generator for HMCC sermon guides. Write a sermon's content
in a YAML file, run one command, and get a clean, self-contained HTML page
styled after [hmcc.net](https://hmcc.net) — big Bebas Neue headlines, Inter
body, white canvas, one warm accent.

No servers, no build pipeline, no AI at runtime. Content in, HTML out.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> **Non-developer?** See [docs/ADD-A-GUIDE.md](docs/ADD-A-GUIDE.md) for a
> step-by-step, browser-only guide that needs no command line. Copy
> [content/_TEMPLATE.yaml](content/_TEMPLATE.yaml) to start a new guide.

## Add a guide

1. Copy an existing file in `content/` (e.g. `content/bible-shorts-9.yaml`) to a
   new name. **The filename becomes the page's URL slug** (`my-sermon.yaml` →
   `my-sermon.html`).
2. Fill in the fields (see the schema below).
3. Build.

## Build

```bash
python build.py                       # build every guide in content/
python build.py content/bible-shorts-9.yaml   # build just one
```

Output lands in `output/` — one `<slug>.html` per guide plus an `index.html`
listing them all. Each HTML file is fully self-contained (CSS is inlined), so
you can open it directly or drop the whole `output/` folder onto any static host
(GitHub Pages, Netlify, Vercel, S3…).

To preview locally:

```bash
python -m http.server -d output 8000   # then visit http://localhost:8000
```

## Content schema

```yaml
series: "Bible Shorts"          # big hero headline
part: "Part 9: Titus 2"         # subtitle under the headline
date: "2026-06-22"              # optional; orders the index (newest first)

scripture_title: "Titus 2"
scripture_ref: "Titus 2"        # optional; ESV reference to fetch (see below)
scripture_passage:              # list of paragraphs (fallback if not fetched)
  - "^2 Older men are to be..."  # ^N renders as a small verse number

recap:                          # list of paragraphs
  - "Pastor Sam continued..."
one_thing: "The single takeaway."   # optional; shown as a highlighted callout

discussion_questions:           # rendered as a grid, in the order listed
  Connecting:
    - "Question one?"
  Confessing:
    - "Question two?"

next_steps_intro: "Optional intro paragraph."
next_steps_title: "Part 9: Titus 2"   # optional sub-label
next_steps:
  - "Do this."
```

Only `series` is strictly required; every other section is omitted gracefully if
left out.

## Scripture from the ESV API (optional)

Instead of pasting the passage into `scripture_passage`, you can let the build
fetch it from the [ESV API](https://api.esv.org) by reference.

1. Register for a free API key at <https://api.esv.org> (non-commercial use).
2. Set it in your environment: `export ESV_API_KEY=...`
3. Give the guide a reference. The build uses `scripture_ref` if present,
   otherwise falls back to `scripture_title`. So for many guides where the title
   *is* a valid reference (e.g. `Luke 1:26-55`), nothing else is needed.
4. Build. Fetched passages are written to `content/.cache/` (committed to the
   repo) so later builds — and CI, which has no key — read from the cache
   instead of the network. Delete a cache file to force a refresh.

If no key is set and there's no cache hit, the build falls back to whatever text
is already in `scripture_passage`, so existing guides keep working untouched.

> The ESV API requires the copyright notice that the template already renders
> beneath each passage. Keep it.

## Customizing the look

All styling lives in `static/styles.css`. The palette and fonts are CSS
variables at the top (`--accent`, `--ink`, `--bg`, `--display`, `--body`) —
change those to retheme the whole site. The page templates are in `templates/`.
