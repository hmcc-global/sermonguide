# Sermon Guide Studio

A small web app that turns a sermon into a published guide in the `sermonguide` site.
Leaders paste a transcript (Phase 1) — soon, upload audio (Phase 2) — generate a draft with
Gemini, review and edit it, and approve. On approve it commits `content/<slug>.yaml` (and a
`transcripts/<slug>.md` archive) to this repo, which triggers the existing build + Pages deploy.

Lives in `studio/` inside the `sermonguide` repo. It does **not** trigger the Python build
(`build.yml` only watches `content/`, `templates/`, `static/`, `build.py`, `requirements.txt`).

## Status — all phases built

- **Phase 1:** paste transcript → guide → review → publish.
- **Phase 2:** upload audio → Vercel Blob → Gemini Files API (two streamed calls: guide + transcript)
  → review → publish. Blob is deleted after processing.
- **Phase 3:** published-guides list, slug/URL display, transcript-failed notice, friendlier errors.

Verified: typecheck + production build clean; contract logic unit-tested against the Python pipeline;
all four API routes runtime-tested for passcode gating and graceful failure. Not yet run against live
Gemini / GitHub / Blob (needs real keys) and not yet deployed.

### Input modes

- **Upload audio** (default): mp3 recommended (m4a/wav accepted). Goes browser → Blob → Gemini.
- **Paste transcript:** no audio; text → Gemini. Fastest, zero upload.

## Local setup

```bash
cd studio
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
```

Required env vars (see `.env.example`):

| Var | What |
|---|---|
| `APP_PASSCODE` | Shared passcode leaders type to use the app. |
| `GEMINI_API_KEY` | From https://aistudio.google.com/apikey (free tier ok). |
| `GITHUB_TOKEN` | Fine-grained PAT, scoped to `sermonguide`. **Contents: Read and write** + **Metadata: Read-only**. |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | `hmcc-global` / `sermonguide` / `main`. |

> Test against a fork or a throwaway branch first (`GITHUB_BRANCH`) so you don't push test guides to the live site.

## Deploy (Vercel)

1. Import the `sermonguide` repo into Vercel.
2. Set **Root Directory = `studio`**.
3. Add the env vars above in the Vercel project settings (none prefixed `NEXT_PUBLIC_`).
4. Confirm **Fluid compute** is enabled (gives 300s functions; needed for Phase 2 audio).

## Contracts honored (must stay in sync with the Python pipeline)

- **Slug:** `("{series} {part}").trim()` → `[^A-Za-z0-9]+` → `-`, strip dashes, lowercase. (`lib/guide.ts`)
- **Date:** always emitted as ISO `YYYY-MM-DD` (its absence would force the legacy layout).
- **Discussion questions:** ordered Connecting → Considering → Confessing → Committing; unknowns appended.
- **Scripture:** writes `scripture_ref` + `scripture_title` only; the site's build fetches the passage
  text from the ESV API (requires `ESV_API_KEY` as a repo Actions secret — confirm it's set).
- **Publish:** both files in one commit via the Git Data API; a PAT commit triggers `build.yml`.
- **Collision:** publish checks for an existing `content/<slug>.yaml` and asks before overwriting.

## Layout

```
studio/
  app/
    page.tsx              # single-page UI: input → working → review
    layout.tsx, globals.css
    api/
      generate/route.ts   # passcode-gated; transcript OR audio(blobUrl) → Gemini → guide (+transcript)
      publish/route.ts    # passcode-gated; assemble YAML + transcript, atomic commit
      upload/route.ts     # passcode-gated Blob client-token minter (onBeforeGenerateToken)
      guides/route.ts     # passcode-gated; lists published guide slugs
  lib/
    auth.ts               # passcode check (fails closed)
    guide.ts              # slug / date / question order / YAML assembly
    gemini.ts             # Gemini call (transcript → guide)
    github.ts             # atomic two-file commit + collision check
```
