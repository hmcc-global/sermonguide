# Sermon Guide Studio + guide site

One Next.js app that both **serves the guide site** and **hosts the authoring studio**:

- `/` — the guide index (ported from `build.py` + Jinja templates, generated at build from `content/*.yaml`)
- `/<slug>.html` — an individual guide (same `.html` URLs as the Pages site)
- `/create` — the studio: upload audio or paste a transcript → Gemini draft → review → publish
- `/manage` — admin-only (separate passcode): list, **edit**, and **delete** published guides

On publish it commits `content/<slug>.yaml` (+ a `transcripts/<slug>.md` archive) to this repo. That
push triggers **two** rebuilds: Vercel regenerates the guide site (new host), and `build.yml` still
deploys GitHub Pages (kept as a backup). GitHub Pages can be retired later.

Lives in `studio/` inside the `sermonguide` repo. Studio/app changes do **not** trigger the Python
`build.yml` (it only watches `content/`, `templates/`, `static/`, `build.py`, `requirements.txt`).

## Architecture

```
studio/
  app/
    layout.tsx              # root: html/body + self-hosted fonts (next/font). No global CSS.
    (site)/                 # the guide site — CSS code-split from the studio
      layout.tsx            #   topbar + footer, imports site.css
      site.css              #   verbatim port of static/styles.css (fonts -> next/font vars)
      page.tsx              #   index (/)
      [guide]/page.tsx      #   guide (/<slug>.html); generateStaticParams, dynamicParams=false
    create/                 # the studio
      layout.tsx            #   imports studio.css
      studio.css            #   the studio's own styles
      page.tsx              #   upload/paste -> review -> publish UI (client)
    manage/                 # admin-only edit/delete (reuses studio.css)
      layout.tsx, page.tsx  #   ADMIN_PASSCODE gate -> list -> edit form / delete
    api/
      generate/route.ts     # passcode-gated; transcript OR audio(blobUrl) -> Gemini -> guide (+transcript)
      publish/route.ts      # passcode-gated; assemble YAML + transcript, atomic commit
      upload/route.ts       # passcode-gated Blob client-token minter (onBeforeGenerateToken)
      guides/route.ts       # passcode-gated; lists published guide slugs
      auth/route.ts         # passcode check for the /create gate
      admin/                # admin-passcode-gated: auth, guides (list+meta), guide (get one),
                            #   save (edit + rename, non-destructive merge), delete (yaml + transcript)
  lib/
    guides.ts               # BUILD-TIME: read ../content/*.yaml, sort, neighbors, humandate, versesHtml
    esv.ts                  # BUILD-TIME: ESV passage fetch + disk cache (port of build.py)
    guide.ts                # slug / date / question order / YAML assembly (studio publish)
    gemini.ts               # Gemini calls (transcript/audio -> guide, transcript)
    github.ts               # atomic two-file commit + collision check
    auth.ts                 # passcode check (fails closed)
```

The guide/index pages are **statically generated at build** by reading `../content` (the repo root).
CSS is code-split by route group, so `site.css` and `studio.css` (which both define `:root` vars)
never load on the same page.

## Local setup

```bash
cd studio
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000  (guides at /, studio at /create)
```

Env vars (see `.env.example`):

| Var | What |
|---|---|
| `APP_PASSCODE` | Passcode for `/create` (generate + publish). |
| `ADMIN_PASSCODE` | Separate passcode for `/manage` (edit + delete). Give only to admins. |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey (free tier ok). |
| `GITHUB_TOKEN` | Fine-grained PAT scoped to `sermonguide`: **Contents: Read and write** + **Metadata: Read-only**. |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | `hmcc-global` / `sermonguide` / `main`. |
| `SITE_URL` | Public base URL of the guide site (the studio's "live" link). Falls back to the github.io URL. |
| `ESV_API_KEY` | **Build-time**, optional. Lets guides that have only a scripture *reference* (studio-published ones) fetch the passage text. Guides with inline `scripture_passage` don't need it. |

> Test against a throwaway `GITHUB_BRANCH` first so publishes don't hit the live site.

## Deploy (Vercel)

1. Import `sermonguide` into Vercel; set **Root Directory = `studio`**.
2. **Enable "Include files outside of the Root Directory in the Build Step"** (Settings → General →
   Root Directory). **Required** — the guide pages read `../content` at build; without it the build
   fails with a missing-directory error.
3. Add the env vars above (none prefixed `NEXT_PUBLIC_`). Set `SITE_URL` to the Vercel domain and
   `ESV_API_KEY` so studio-published (reference-only) guides render their passage.
4. Confirm **Fluid compute** is on (300s functions; needed for Phase 2 audio).
5. A push to `main` (including a studio publish) auto-rebuilds the site on Vercel.

## Fidelity to build.py (guide rendering)

Replicated 1:1: slug / date / question order / `legacy_layout` (honoring an explicit value) / sort
(stable `order` tie-break then codepoint `date` desc) / prev-next neighbors / `^N` verse markers /
`humandate` (`%b %-d, %Y`, non-zero-padded ok) / markupsafe-equivalent escaping.

**Scripture** matches `build.py`: when a guide has a reference (`scripture_ref` or `scripture_title`),
the build fetches the ESV passage and it overrides any inline text; on failure (no `ESV_API_KEY`, cache
miss, network error) it falls back to the inline `scripture_passage`. So:

- With `ESV_API_KEY` set at build (Vercel) → all guides render fresh ESV, identical to the Pages backup.
- Without it (e.g. local dev) → guides with inline text render that; **reference-only guides (every
  studio-published guide) show no scripture until the key is set.** A build warning names any guide
  whose reference couldn't be resolved. **Set `ESV_API_KEY` in Vercel.**
