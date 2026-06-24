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
scripture_passage:              # list of paragraphs
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

## Customizing the look

All styling lives in `static/styles.css`. The palette and fonts are CSS
variables at the top (`--accent`, `--ink`, `--bg`, `--display`, `--body`) —
change those to retheme the whole site. The page templates are in `templates/`.
