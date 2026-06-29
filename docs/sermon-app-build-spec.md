# Sermon Guide App — Build Spec

A web tool any church leader can use to turn a sermon recording into a published guide:
**upload mp3 → AI generates a draft → leader reviews & edits → approve → live.**

The app is the new authoring surface. The existing `sermonguide` repo + `build.py` + GitHub
Pages pipeline is the unchanged publishing backend. Leaders never touch GitHub, markdown, or a
local machine.

> Status: **plan only.** Nothing here is built yet. This document is the contract to build from.

---

## 1. Architecture at a glance

```
[Leader browser]  passcode → metadata + mp3
      │  (1) client upload, direct to Blob (skips the 4.5 MB function-body limit)
      ▼
[Vercel Blob]  temporary mp3
      │  (2) /api/generate fetches the blob, uploads to Gemini Files API, deletes the blob
      ▼
[Gemini 2.5 Flash]  (3) two streamed calls on the same uploaded file:
      │                  call A → guide JSON   |   call B → transcript text
      ▼
[Leader browser]  (4) editable review fields + live preview → Approve
      │  (5) /api/publish commits TWO files in ONE commit (Git Data API)
      ▼
[GitHub repo]  content/<slug>.yaml  +  transcripts/<slug>.md
      │  (6) push triggers existing build.yml (unchanged)
      ▼
[GitHub Pages]  (7) live at github.io/sermonguide/<slug>.html  (~1–2 min)
```

No database. No auth provider. State lives in the browser between generate and publish; the
repo is the only durable store.

**Stack:** Next.js on Vercel (Hobby) · Vercel Blob · Gemini API (free or paid) · GitHub REST
API via `@octokit/rest` · optional ESV API. One platform + the AI + the repo.

---

## 2. What the research changed (read before building)

These are corrections to earlier assumptions — each is now baked into the design.

1. **Vercel Hobby function max duration is 300s** for projects on **Fluid compute** (default for
   projects created after 2025-04-23). The old "60s" is the *legacy* (non-Fluid) number.
   → Action: create a fresh project, confirm Fluid compute is on, set `export const maxDuration = 300`.
   The 40–120s generate call fits with margin.

2. **Gemini non-streaming calls hit a ~60s infrastructure timeout** independent of Vercel, and a
   45-min audio + full transcript can exceed it. → Action: **stream** Gemini (`streamGenerateContent`
   / `generateContentStream`).

3. **Transcript-in-JSON silently truncates.** Default `maxOutputTokens` is **8,192**; if a structured
   (JSON) response overflows it, Gemini returns `finishReason: MAX_TOKENS` and the parsed object comes
   back **null** — the whole guide is lost. → Action: keep the transcript OUT of the guide JSON. Use
   **two calls** (guide JSON, small; transcript as plain streamed text with `maxOutputTokens: 65536`).

4. **Gemini free tier trains on your data and humans may review it.** "Do not submit sensitive,
   confidential, or personal information to the Unpaid Services." **DECISION: free tier accepted** —
   sermons are public teaching. Mitigation: don't publish congregant full names / private specifics in
   the guide text (the review step is the safety net). Revisit if a series gets sensitive.

5. **Free-tier rate limits are low and volatile** (a Dec 2025 cut; daily request caps can be ~20–250/day
   and are only visible at aistudio.google.com/rate-limit). One sermon/week = fine. Heavy dev testing
   will exhaust the daily quota. → Action: test with short clips or a paid key during development.

6. **`gemini-2.0-flash` is shut down.** Use **`gemini-2.5-flash`** (audio-capable, 65,536 output cap).

7. **Vercel `onUploadCompleted` webhook does not fire on localhost** (needs an ngrok tunnel). → Action:
   do NOT depend on that webhook; the browser drives the flow using the blob URL returned by `upload()`.

8. **A commit made with a PAT triggers `on: push` Actions; a commit made with the in-Actions
   `GITHUB_TOKEN` does not.** Since this app commits with a fine-grained PAT from outside Actions, the
   deploy fires correctly. (Trap to remember if this logic ever moves into a workflow.)

9. **Repo slug has no collision check** — writing `content/<slug>.yaml` twice silently overwrites.
   → Action: the app checks for an existing file and warns before overwrite (§5.4).

---

## 3. Accounts, keys, and one-time setup

| Item | Where | Notes |
|---|---|---|
| Vercel project | vercel.com (Hobby) | Confirm **Fluid compute** enabled. |
| Vercel Blob store | Vercel dashboard | Auto-creates `BLOB_READ_WRITE_TOKEN` (server-side only). |
| Gemini API key | aistudio.google.com | Free or paid (see §10). |
| GitHub fine-grained PAT | github.com settings | Scoped to **`hmcc-global/sermonguide` only**. Perms: **Contents: Read and write** + **Metadata: Read-only**. No "Workflows" perm needed. |
| Shared passcode | invented | Stored as a server env var; given to leaders. |

**App location: a folder inside the `sermonguide` repo** (DECISION). Put the Next.js app under e.g.
`app/` (NOT `content/`, `templates/`, `static/`, or `build.py` — those paths trigger the Python build).
- Set the **Vercel project Root Directory** to that subfolder so Vercel builds only the app.
- App code changes will NOT trigger `build.yml` (its `paths:` filter doesn't include the app folder) —
  good, no spurious Pages rebuilds.
- Two deploy targets on one repo is fine: **Vercel** serves the app; **GitHub Pages** serves the guide
  site. They don't collide.
- The app's `/api/publish` commits to its own repo — that's expected and works.
- **No ESV key needed in the app** (scripture handled by CI — see §5.3).

---

## 4. Data flow & endpoint contracts

### 4.1 Browser → Blob (client upload)
- Use `upload()` from `@vercel/blob/client` with `handleUploadUrl: '/api/upload'`.
- `access: 'public'`, restrict `allowedContentTypes: ['audio/mpeg','audio/mp3']`, `addRandomSuffix: true`.
- 30–50 MB mp3 is far under all limits (5 TB max, 512 MB cache). Returns `{ url }`.

### 4.2 `/api/upload` (token minter)
- Calls `handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted })`.
- **`onBeforeGenerateToken` MUST verify the passcode** (from a header/cookie). Without this the upload
  route is public. Lock content types here too.
- `onUploadCompleted` may be a no-op (we don't depend on it; it won't fire on localhost anyway).

### 4.3 `/api/generate`  (Node runtime, `maxDuration = 300`)
**Input:** `{ blobUrl, metadata }` where metadata = `{ date, preacher, series, part, scriptureRef, scriptureTitle }`.
**Steps:**
1. Verify passcode.
2. `fetch(blobUrl)` → bytes (outbound fetch is not subject to the 4.5 MB request-body limit).
3. Upload bytes to **Gemini Files API**, mime `audio/mp3` → `fileUri`. (Re-used by both calls; valid 48h.)
4. `del(blobUrl)` — blob's job is done.
5. **Call A — guide** (`gemini-2.5-flash`, `thinkingBudget: 0`, `responseMimeType: application/json`,
   `responseSchema` = §6.1, `maxOutputTokens: 4096`, streamed). Returns the structured guide content.
6. **Call B — transcript** (same `fileUri`, plain text, streamed, `maxOutputTokens: 65536`,
   `thinkingBudget: 0`). **Wrapped in try/catch** — if it fails/times out, return `transcript: null`
   so the guide still publishes. Transcript is "nice to have," never blocking.
7. Scripture is NOT fetched here — the app only carries the leader's `scriptureRef`/`scriptureTitle`
   through to the YAML; CI resolves the passage at build time (§5.3).
**Output:** `{ guide, transcript }` — held in the browser, no server state.

> The browser waits through both calls (a spinner; ~1–2 min worst case). Acceptable for v1 on the 300s
> budget. If waits feel long later, the upgrade path is to split into `/api/generate` (guide only, fast)
> + a background `/api/transcript`, but do NOT build that for v1.

### 4.4 `/api/publish` (Node runtime)
**Input:** `{ finalGuide, transcript, metadata }` (the leader's edited values).
**Steps:**
1. Verify passcode.
2. Compute `slug` (§5.1). **GET** `content/<slug>.yaml` via the API; if it exists, return a
   "would overwrite" warning unless the request carries `confirmOverwrite: true`.
3. Assemble the YAML string (§5.2) and the transcript markdown.
4. Commit **both files in one commit** via the Git Data API (§6.3), `force: false`, retry once on 409.
5. Return `{ liveUrl: "https://hmcc-global.github.io/sermonguide/<slug>.html" }`.
The push triggers `build.yml`; the guide is live in ~1–2 min.

---

## 5. The guide contract (exact rules, verified against the repo)

### 5.1 Slug — replicate byte-for-byte
```
base = (series + " " + (part or "")).trim()
slug = base.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "guide"
```
File path: `content/<slug>.yaml`. No collision protection in the pipeline → app must check (§4.4).

### 5.2 YAML schema written by the app
Required: `series`, `date`. **Always emit `date`** (ISO `YYYY-MM-DD`) — its absence flips the page to
"legacy layout." Recommended full shape:

```yaml
series: ADORE
part: "Part 5: ..."           # optional but normal
date: 2026-06-28              # ISO; REQUIRED to get modern layout
preacher: Pastor Pete Dahlem  # optional
scripture_title: Luke 2:1-20  # display label
scripture_ref: Luke 2:1-20    # used for ESV fetch
scripture_passage:            # see §5.3 — embed OR rely on CI
  - "^1 ..."
recap:                        # list of paragraph strings
  - "..."
one_thing: "..."             # single string
discussion_questions:         # dict; order enforced below
  Connecting: ["..."]
  Considering: ["..."]
  Confessing: ["..."]
  Committing: ["..."]
next_steps_intro: "..."      # optional
next_steps_title: "..."      # optional
next_steps: ["..."]          # list
```
- **Discussion-question order:** sort categories case-insensitively into
  `Connecting → Considering → Confessing → Committing`; append any unknown categories in original order.
- `discussion_questions` is `dict[str, list[str]]`; `recap`/`next_steps`/`scripture_passage` are
  `list[str]`; `one_thing`/`next_steps_intro`/`next_steps_title` are strings.
- Do NOT set `slug`, `legacy_layout`, `newer`, `older` — build.py injects those.

### 5.3 Scripture — DECISION: let CI fetch (option B)
The app writes only `scripture_ref` + `scripture_title` (no `scripture_passage`). The existing build
resolves the passage from the ESV API at build time. **This mirrors exactly what the issue-form path
already does** — `guide_from_markdown.py` never writes `scripture_passage`, and recent guides created
that way (`bible-shorts-titus-3.yaml`, `poured-out-2/3.yaml`) ship with only a ref and render scripture
fine on the live site. So the mechanism is already proven.

Facts that make this safe:
- `build.yml` passes `ESV_API_KEY: ${{ secrets.ESV_API_KEY }}` to the build. The newest ref-only guides
  rendering correctly is strong evidence the secret **is** set. → **One-time confirm: Bo verifies
  `ESV_API_KEY` exists in repo Settings → Secrets → Actions.**
- If the key were ever missing, the failure mode is graceful (scripture section omitted, no build error)
  — but verify it once so it never bites.
- Never let Gemini generate scripture text (hallucination risk) — always ESV.

Minor existing-repo note (not this app's job to fix): `content/.cache/` is **not committed**, so CI
re-fetches references each build. Harmless at this scale; flagged only for awareness.

### 5.4 Build trigger facts
- `build.yml` fires on push to `main` touching `content/**`, `templates/**`, `static/**`, `build.py`,
  `requirements.txt`, `.github/workflows/build.yml`. It checks out `ref: main` (latest tip).
- `transcripts/` is **not** in that list — a transcript-only change wouldn't deploy, but since both
  files land in **one commit that also touches `content/**`**, the single commit triggers exactly one build.
- `build.py` loads `content/*.yaml|*.yml` not starting with `_`; subdirectories are ignored. Keep
  transcripts at top-level `transcripts/` (outside `content/`) so they're never rendered as pages.

---

## 6. Component specs

### 6.1 Guide JSON schema (Gemini structured output, Call A)
```
{
  recap: string[],                 // 2–4 paragraphs
  one_thing: string,
  discussion_questions: {          // object; keys are the four categories
    Connecting: string[], Considering: string[],
    Confessing: string[], Committing: string[]
  },
  next_steps: string[],
  next_steps_intro?: string,
  next_steps_title?: string
}
```
Use `propertyOrdering` to fix order. Metadata (date/preacher/series/part/scripture) is NOT generated —
it comes from the leader's form. Keep this schema small and flat (well within Gemini limits).

### 6.2 The page (single screen, three states)
- **State 1 — input:** passcode gate (once), then fields: date, preacher, series, part, scripture
  reference, + file picker. "Generate" disabled until an mp3 and the required fields are set.
- **State 2 — working:** progress ("uploading… generating guide… transcribing…"). No tabs/hidden
  sections.
- **State 3 — review:** editable structured fields (recap, one_thing, 4 question groups, next_steps) +
  a **live preview** that reuses the repo's `static/styles.css` so it matches the published page. Show
  the computed slug + target URL. "Approve & publish" button. Surface a transcript-failed notice if any.

### 6.3 GitHub commit (atomic two-file)
Sequence via `@octokit/rest` (Node runtime, PAT auth):
1. `git.getRef({ ref: "heads/main" })` → parent commit SHA.
2. `git.getCommit({ commit_sha })` → base tree SHA.
3. `git.createTree({ base_tree, tree: [ {path:'content/<slug>.yaml', mode:'100644', type:'blob', content: yamlStr}, {path:'transcripts/<slug>.md', mode:'100644', type:'blob', content: mdStr} ] })`.
   (Inline `content` for text files — skip separate blob creation.)
4. `git.createCommit({ message, tree, parents: [parentSha] })`.
5. `git.updateRef({ ref: "heads/main", sha: commitSha, force: false })`.
- On **409** (someone else pushed): re-run from step 1 (retry 2–3×). Never `force: true`.
- `transcripts/` auto-creates (git has no empty dirs).

### 6.4 Auth (passcode)
- One shared `APP_PASSCODE` env var. The page collects it once, stores it (session cookie / header).
- **Every** API route (`/api/upload`, `/api/generate`, `/api/publish`) re-checks it. The Blob
  `onBeforeGenerateToken` check is the critical one — without it the upload route is open to the world.
- Not a real identity system; fine for a few trusted leaders. (Upgrade path: Vercel-side access control
  or an email allowlist if you ever want per-user "approved by".)

---

## 7. Environment variables

| Var | Used by | Exposed to browser? |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | `/api/upload` | No — never. |
| `GEMINI_API_KEY` | `/api/generate` | No. |
| `GITHUB_TOKEN` (fine-grained PAT) | `/api/publish` | No. |
| `GITHUB_OWNER` / `GITHUB_REPO` | `/api/publish` | No (or hardcode). |
| `APP_PASSCODE` | all routes | No. |

(No `ESV_API_KEY` in the app — scripture is resolved by CI, §5.3. The repo's own
`ESV_API_KEY` Actions secret stays as-is.)

**Never** prefix any of these `NEXT_PUBLIC_` — that inlines them into client JS at build time, readable
by anyone. All secrets stay un-prefixed (server runtime only).

---

## 8. Failure modes & handling

| Failure | Detection | Handling |
|---|---|---|
| mp3 too big for function | n/a — avoided | Client upload to Blob bypasses the 4.5 MB body limit. |
| Gemini guide call times out (~60s) | streamed call errors | Stream + `thinkingBudget:0` keep it fast; surface a retry button. |
| Transcript truncated (MAX_TOKENS) | `finishReason` | Transcript is a separate plain-text call w/ 65,536 cap; not in the JSON, so the guide is never lost. |
| Transcript call fails entirely | try/catch | Return `transcript: null`; guide still publishes; show a notice; allow retry. |
| Gemini free-tier RPD exhausted | 429 | Expected during heavy dev testing — use short clips or a paid key; one-per-week prod is fine. |
| Slug collision (overwrite) | GET contents pre-check | Warn; require `confirmOverwrite`. |
| Concurrent commit (409) | updateRef response | Retry the Git Data sequence 2–3×, `force:false`. |
| Scripture missing on site | no `scripture_passage` + no CI key | Confirm CI `ESV_API_KEY` once (§5.3); failure mode is graceful (section omitted, no build break). |
| Blob storage creep | n/a | `del()` the blob right after Gemini upload (del is free). |
| Vercel project is legacy (60s cap) | check project settings | Confirm Fluid compute; recreate project if needed. |

---

## 9. Cost & privacy decisions (conscious choices required)

1. **Gemini tier — DECISION: free tier.** Accepted that content is used by Google / may be
   human-reviewed; sermons are public teaching. Safety net: the review step lets the leader scrub any
   sensitive specifics before publishing. Reconsider paid (still pennies, no training) only if a future
   series carries genuinely private content.
2. **Hosting** — Vercel Hobby + Supabase-free not needed (no DB). Blob stays free if you `del()` after
   use. Realistically $0/mo at this volume. Only watch: Hobby Blob/transfer caps are **hard lockouts**,
   not overages — deleting blobs keeps you clear.

---

## 10. Build phases (de-risk the hard part)

**Phase 0 — scaffold.** Next.js app on Vercel (Fluid confirmed). Passcode gate. Env vars set. GitHub
PAT created & tested with a throwaway commit. ESV decision made (§5.3).

**Phase 1 — the spine, no audio.** A form that takes **pasted transcript text** + metadata →
`/api/generate` (Gemini text→guide JSON, no Files API yet) → review screen → `/api/publish` (atomic
commit) → live. This proves generation + review UI + GitHub publish with **zero timeout/upload risk**.
Internal milestone.

**Phase 2 — add audio (shipped v1).** Blob client upload → `/api/generate` uploads to Gemini Files API,
two streamed calls (guide + transcript), `del()` blob. Commit `transcripts/<slug>.md` alongside the
YAML. This is the product leaders use.

**Phase 3 — polish.** Live preview matched to `styles.css`; slug/URL display; transcript-failed notice
+ retry; a simple list of recently published guides (read from the repo); friendlier errors.

---

## 11. Decisions — locked & remaining
Locked:
- [x] **Gemini free tier** (§9.1) — accepted, review step scrubs sensitive specifics.
- [x] **Scripture via CI** (§5.3) — app writes ref+title only, mirrors the issue-form path.
- [x] **App lives in a folder inside `sermonguide`** (§3) — Vercel root dir set to that subfolder.

Remaining (small):
- [ ] **Confirm `ESV_API_KEY` is a repo Actions secret** (one-time, §5.3). Evidence says yes; verify in
  Settings → Secrets → Actions.
- [ ] **Confirm the ~1–2 min synchronous spinner is acceptable** for v1 (§4.3). If not, plan the
  background-transcript upgrade before Phase 2.

## 12. Explicitly out of scope for v1
Multi-user identity / per-user "approved by", separate reviewer/approver roles, draft persistence
across sessions, in-app editing of *published* guides, audio storage/archive (audio is deleted),
verbatim-transcript-as-page (transcripts are archive-only, not rendered).
