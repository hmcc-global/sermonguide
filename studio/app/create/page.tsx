"use client";

import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Field, AutoTextarea } from "@/components/fields";
import {
  parseTranscript,
  wordCount,
  looksLikeCaptions,
  MAX_TRANSCRIPT_BYTES,
  TRANSCRIPT_ACCEPT,
} from "@/lib/transcript";

type Stage = "input" | "working" | "review";
type Mode = "audio" | "file" | "paste";

type Meta = {
  series: string;
  part: string;
  date: string;
  preacher: string;
  scripture: string;
};

type Draft = {
  recap: string;
  one_thing: string;
  connecting: string;
  considering: string;
  confessing: string;
  committing: string;
  next_steps_intro: string;
  next_steps_title: string;
  next_steps: string;
};

type GuideRef = { slug: string; url: string };

type InboxRow = {
  id: string;
  title: string;
  date?: string;
  preacher?: string;
  source?: string;
  receivedAt?: string;
  words?: number;
};

const EMPTY_DRAFT: Draft = {
  recap: "",
  one_thing: "",
  connecting: "",
  considering: "",
  confessing: "",
  committing: "",
  next_steps_intro: "",
  next_steps_title: "",
  next_steps: "",
};

// Copied verbatim, unmodified, for the "Copy prompt for another AI" button —
// lets an editor run generation in their own AI (ChatGPT, Claude, etc.) when
// Gemini's free tier is unavailable, then paste the markdown result into
// Markdown mode.
const EXTERNAL_AI_PROMPT = `You are creating a sermon summary and Bible study discussion guide from a sermon transcript, notes, or outline. The output is clean, copy-pastable markdown that works equally well for individual study and small group facilitation.
Read the input carefully and identify: the sermon title, the speaker/pastor's name, the primary Scripture passage(s), the main theme or "one thing" takeaway, key illustrations or stories, and any explicit calls to action.
Produce the output as markdown using this EXACT structure, headings, ordering, and bullet style:

\`\`\`
# SERIES — Part N: Subtitle
Date: YYYY-MM-DD
Scripture: [primary passage reference]
Preacher: [Pastor Name]
## Recap
First paragraph.

Second paragraph.

Third paragraph.

Fourth paragraph.
## One Thing
The single biggest takeaway, in one sentence.
## Discussion Questions
### Connecting
- An opening, low-stakes question?
- Another connecting question?
### Considering
- An observational/analytical question about the text?
- An observational/analytical question about the text?
### Confessing
- A question that surfaces personal struggle?
- A question that surfaces personal struggle?
### Committing
- A question about what to do this week?
- A question about what to do this week?
## Next Steps
- First concrete step.
- Second step.
- Third step.

\`\`\`

Formatting rules:

* Title line: Use \`# SERIES — Part N: Subtitle\` when the sermon is part of a numbered series (e.g., \`# BIBLE SHORTS — Part 6: Jude\`), with the series name in caps. The em dash in this title line is the ONLY em dash permitted in the entire output. If it is not part of a series, use the sermon title (e.g., \`# Joshua 1: Be Strong and Courageous\`). If there is no clear series or title, create a short descriptive title from the main passage and theme.
* Date line: \`Date: YYYY-MM-DD\`. Use the date if provided. If no date is available anywhere, write \`Date: [date]\` rather than guessing.
* Scripture line: the primary passage(s) preached, e.g., \`Scripture: Titus 2:1-15\`.
* Preacher line: \`Preacher: Pastor [Name]\`, or the speaker's title and name as given (e.g., \`Preacher: Dr. Ron White\`).
* The Discussion Questions category order is fixed: Connecting, then Considering, then Confessing, then Committing. Never reorder.
* Questions and next steps use \`-\` bullets, never numbers.
* Add no other headings, preambles, or closing remarks. The output starts at the \`#\` title line and ends with the last Next Step bullet.

Recap section (3-4 paragraphs):

* Write a warm, clear narrative, not bullets or an outline. The tone is a thoughtful church member explaining the sermon to a friend who missed Sunday.
* Weave in: the sermon's place in any larger series, the primary Scripture and what was drawn from it, key illustrations or real-life examples with enough detail that someone who wasn't there can follow, and the throughline connecting everything.
* Keep it to 4 paragraphs of moderate length, roughly 350-450 words total. This is a summary, not a transcript. Cut ruthlessly. Do not exceed this range no matter how long the source is.
* Refer to the speaker by name throughout as "Pastor [Firstname]," not "the pastor."

One Thing: the sermon's core takeaway as a single sentence. If the speaker stated a "one thing" or bottom line, use it. Otherwise distill one.
Writing style:

* Do NOT use em dashes anywhere except the one permitted title line. Use commas, periods, or restructure the sentence. If you reach for an em dash, rewrite.
* No academic or heavy theological language. Aim for the reading level of a church bulletin, not a seminary paper.
* Write like a person. Vary sentence length. Let some sentences be short. Don't over-qualify.
* When referencing Scripture, include the reference (e.g., "Matthew 5:13-16") but don't over-quote; paraphrase naturally.

Avoid these AI writing hallmarks:

* Transitional hype phrases like "The second half turns urgent" or "[Book] is short and easy to overlook, but Pastor X found real treasure in it." Describe what happened without editorializing about the book or labeling passages as "sobering," "rich," "powerful," etc.
* Commentary on the pastor's approach or delivery ("Pastor X got personal here," "made the point plainly," "was careful to draw the right distinction"). Summarize what was said, not how well it was said. Use neutral framing like "Pastor X reminded us that...," "noted that...," "shared from his own life...," "pointed out that...". Do not evaluate or praise the pastor's skill.
* Parallel sentence pairs for dramatic effect, like "Someone genuinely seeking deserves a warm welcome. Someone trying to mislead is a different situation entirely." Fold the thought into one natural sentence.
* Overused X-and-Y constructions. Don't repeat the same coupled phrase ("truth and love," "truth, love, and obedience") several times. Vary phrasing.
* Throat-clearing openers like "This message continued...," "This week, Pastor X turned to...," or "[Book] is one of the shortest books in the Bible, but...". Get into the content faster.
* Filler affirmations like "real treasure," "a striking question," "a powerful reminder," "sobering territory." Just say the thing.
* Meta-commentary on the sermon's structure like "The first half is warm. The second half turns urgent." Describe the content directly.

Discussion Questions (8 total, exactly 2 per category). Keep each short and direct, one sentence ideally, two at most. No compound multi-part questions.

* Connecting (2): the warm-up. Genuinely lighthearted, requiring no personal sharing, so everyone talks and smiles before it goes deeper. Find a clever angle on the sermon's theme anyone could answer without feeling exposed. Good examples of the right tone: "Why do you think most people can easily name someone richer than themselves, but rarely think of themselves as rich?"; "What comes to mind when you hear the phrase 'salt and light'?"; "When you hear the word stewardship, what images come to mind?" Save personal vulnerability for Confessing.
* Considering (2): observation and interpretation questions about the Scripture text itself. Point people to the passage; ask what it says, what stands out, what the author commands or warns. Do NOT reference the pastor or what they said. Good: "In 1 Timothy 6:17-19, what attitudes does Paul warn the rich about, and what actions does he encourage instead?" Avoid: "How did Pastor Sam explain this passage?"
* Confessing (2): invite honest personal reflection on where people struggle or where the message hit home. One honest question each, not compound.
* Committing (2): push toward action, specific enough to be actionable ("who is one person...", "what is one step...") rather than vague ("how can you be better?").

Next Steps (exactly 3 bullets): practical action items drawn directly from the sermon, each one short line, something someone could screenshot or stick on their fridge. If the pastor gave explicit action steps or challenges, use those rather than inventing new ones.
Edge cases:

* If the transcript is messy or full of filler words, clean it up. Extract the substance and ignore the "ums" and tangents.
* If no Scripture passage is obvious, focus the recap on themes and illustrations, and for Considering questions ask about the principles or ideas presented rather than a specific text.
* If the sermon is part of a series, mention the series name and how this message connects to the larger arc.

Now produce the guide from the sermon content that follows.`;

function slugify(text: string): string {
  const s = text
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();
  return s || "guide";
}

const lines = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const paras = (s: string): string[] =>
  s
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);

function getCat(dq: Record<string, string[]>, name: string): string[] {
  const key = Object.keys(dq).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? dq[key] : [];
}

// ---- Markdown mode ---------------------------------------------------------
//
// Mirrors the format documented in docs/ADD-A-GUIDE.md and parsed by
// scripts/guide_from_markdown.py (the "paste into a GitHub issue" path), so a
// guide drafted here and one drafted as an issue are interchangeable:
//
//   # SERIES — Part N: Subtitle
//   Date: 2026-06-22
//   Scripture: Luke 1:46-55
//   Preacher: Pastor Pete Dahlem
//
//   ## Recap
//   First paragraph.
//
//   Second paragraph.
//
//   ## One Thing
//   ...
//   ## Discussion Questions
//   ### Connecting
//   - ...
//   ## Next Steps
//   - ...
//
// Markdown is only ever applied to the fields on "switch to Fields" — never
// read live off the textarea — so Publish/Regenerate always act on `draft`,
// never on unapplied markdown edits.

function isMetaEmpty(m: Meta): boolean {
  return !m.series.trim() && !m.part.trim() && !m.date.trim() && !m.preacher.trim() && !m.scripture.trim();
}

function isDraftEmpty(d: Draft): boolean {
  return (
    !d.recap.trim() &&
    !d.one_thing.trim() &&
    !d.connecting.trim() &&
    !d.considering.trim() &&
    !d.confessing.trim() &&
    !d.committing.trim() &&
    !d.next_steps_intro.trim() &&
    !d.next_steps.trim()
  );
}

function draftToMarkdown(meta: Meta, draft: Draft): string {
  const series = meta.series.trim() || "Series";
  const titleLine = meta.part.trim() ? `# ${series} — ${meta.part.trim()}` : `# ${series}`;
  const out: string[] = [titleLine];
  if (meta.date.trim()) out.push(`Date: ${meta.date.trim()}`);
  if (meta.scripture.trim()) out.push(`Scripture: ${meta.scripture.trim()}`);
  if (meta.preacher.trim()) out.push(`Preacher: ${meta.preacher.trim()}`);
  out.push("");

  out.push("## Recap");
  out.push(paras(draft.recap).join("\n\n"));
  out.push("");

  out.push("## One Thing");
  out.push(draft.one_thing.trim());
  out.push("");

  out.push("## Discussion Questions");
  for (const [name, v] of [
    ["Connecting", draft.connecting],
    ["Considering", draft.considering],
    ["Confessing", draft.confessing],
    ["Committing", draft.committing],
  ] as const) {
    out.push(`### ${name}`);
    const items = lines(v);
    if (items.length) out.push(items.map((q) => `- ${q}`).join("\n"));
  }
  out.push("");

  out.push("## Next Steps");
  if (draft.next_steps_intro.trim()) out.push(draft.next_steps_intro.trim());
  const steps = lines(draft.next_steps);
  if (steps.length) out.push(steps.map((s) => `- ${s}`).join("\n"));

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// "SERIES — Part N: Subtitle" -> { series, part }. Accepts em dash, en dash, or
// " - " as the separator, matching scripts/guide_from_markdown.py exactly so
// the same title line parses the same way in both places.
function splitTitleLine(title: string): { series: string; part: string } {
  const m = title.match(/^(.*?)\s+[—–-]\s+(.*)$/);
  if (m) return { series: m[1].trim(), part: m[2].trim() };
  return { series: title.trim(), part: "" };
}

// Tolerates markdown emphasis around the label, e.g. "**Date:** ...".
function headerField(headerText: string, name: string): string {
  const re = new RegExp(`^\\s*[*_]*\\s*${name}\\s*[*_]*\\s*:\\s*[*_]*\\s*(.+?)\\s*[*_]*$`, "im");
  const m = headerText.match(re);
  return m ? m[1].trim() : "";
}

function normalizeDateLoose(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

// Splits a block into paragraphs on blank lines, collapsing internal
// whitespace/newlines within each paragraph — standard markdown semantics,
// and what scripts/guide_from_markdown.py does for the same input.
function paragraphsFromBlock(block: string): string[] {
  return block
    .trim()
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function listItemsFromBlock(block: string): string[] {
  const items: string[] = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(.*)/);
    if (m && m[1].trim()) items.push(m[1].trim());
  }
  return items;
}

// Maps each "## Heading" to the text beneath it (lower-cased keys). "###" is
// excluded since it starts with "##" too.
function markdownSections(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of body.split("\n")) {
    if (/^##\s+/.test(line) && !line.startsWith("###")) {
      if (current !== null) result[current] = buf.join("\n").trim();
      current = line.replace(/^##\s+/, "").trim().toLowerCase();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) result[current] = buf.join("\n").trim();
  return result;
}

// Maps each "### Category" to its bullet list, preserving the heading's own case.
function markdownSubsections(block: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of block.split("\n")) {
    if (/^###\s+/.test(line)) {
      if (current !== null) result[current] = listItemsFromBlock(buf.join("\n"));
      current = line.replace(/^###\s+/, "").trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) result[current] = listItemsFromBlock(buf.join("\n"));
  for (const k of Object.keys(result)) if (!result[k].length) delete result[k];
  return result;
}

const KNOWN_TOP_SECTIONS = ["recap", "one thing", "discussion questions", "next steps"];
const KNOWN_CATEGORIES = ["connecting", "considering", "confessing", "committing"];

type MarkdownParseResult =
  | {
      ok: true;
      isBlank: boolean;
      meta: { series: string; part: string; date?: string; preacher?: string; scripture?: string };
      draft: Draft;
      warnings: string[];
    }
  | { ok: false; error: string };

function parseGuideMarkdown(raw: string): MarkdownParseResult {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) {
    return { ok: true, isBlank: true, meta: { series: "", part: "" }, draft: { ...EMPTY_DRAFT }, warnings: [] };
  }

  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (!titleMatch || titleMatch.index === undefined) {
    return {
      ok: false,
      error:
        'Couldn’t find the title line. The first line should start with "# " — for example: ' +
        '"# ADORE — Part 5: Worship With Joy".',
    };
  }
  const warnings: string[] = [];
  if (text.slice(0, titleMatch.index).trim()) {
    warnings.push('Text before the "# " title line isn’t recognized and won’t be imported.');
  }

  const { series, part } = splitTitleLine(titleMatch[1]);

  const headerZone = text.slice(titleMatch.index + titleMatch[0].length);
  const firstSectionMatch = headerZone.match(/^##\s+/m);
  const headerText =
    firstSectionMatch && firstSectionMatch.index !== undefined
      ? headerZone.slice(0, firstSectionMatch.index)
      : headerZone;

  const dateRaw = headerField(headerText, "date");
  const date = dateRaw ? normalizeDateLoose(dateRaw) : null;
  if (dateRaw && !date) {
    warnings.push(`Date "${dateRaw}" wasn’t recognized and was left as it was.`);
  }
  const scripture = headerField(headerText, "scripture");
  const preacher = headerField(headerText, "preacher");

  const knownLabel = /^\s*[*_]*\s*(date|scripture|preacher)\s*[*_]*\s*:/im;
  if (headerText.split("\n").some((l) => l.trim() && !knownLabel.test(l))) {
    warnings.push(
      'Text between the title and the first "## " heading isn’t recognized and won’t be imported.',
    );
  }

  const secs = markdownSections(text);
  for (const key of Object.keys(secs)) {
    if (!KNOWN_TOP_SECTIONS.includes(key)) {
      warnings.push(`Section "## ${key}" isn’t a recognized heading and won’t be imported.`);
    }
  }

  const recap = secs["recap"] ? paragraphsFromBlock(secs["recap"]) : [];
  const oneThing = secs["one thing"] ? secs["one thing"].replace(/\s+/g, " ").trim() : "";

  const dqBlock = secs["discussion questions"] ?? "";
  const dqRaw = markdownSubsections(dqBlock);
  for (const k of Object.keys(dqRaw)) {
    if (!KNOWN_CATEGORIES.includes(k.toLowerCase())) {
      warnings.push(
        `Discussion category "### ${k}" isn’t Connecting/Considering/Confessing/Committing and won’t be imported.`,
      );
    }
  }
  const firstSub = dqBlock.match(/^###\s+/m);
  const dqPreamble = firstSub && firstSub.index !== undefined ? dqBlock.slice(0, firstSub.index) : dqBlock;
  if (dqPreamble.trim()) {
    warnings.push(
      'Text under "## Discussion Questions" before the first "### " category won’t be imported.',
    );
  }

  const nextStepsBlock = secs["next steps"] ?? "";
  const nextSteps = listItemsFromBlock(nextStepsBlock);
  const introLines: string[] = [];
  for (const line of nextStepsBlock.split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) break;
    if (line.trim()) introLines.push(line.trim());
  }

  const draft: Draft = {
    recap: recap.join("\n\n"),
    one_thing: oneThing,
    connecting: getCat(dqRaw, "connecting").join("\n"),
    considering: getCat(dqRaw, "considering").join("\n"),
    confessing: getCat(dqRaw, "confessing").join("\n"),
    committing: getCat(dqRaw, "committing").join("\n"),
    next_steps_intro: introLines.join(" "),
    next_steps_title: "",
    next_steps: nextSteps.join("\n"),
  };

  return {
    ok: true,
    isBlank: false,
    meta: {
      series,
      part,
      date: date ?? undefined,
      preacher: preacher || undefined,
      scripture: scripture || undefined,
    },
    draft,
    warnings,
  };
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isRateLimitError(message: string): boolean {
  return /429|quota|rate.?limit|resource_exhausted/i.test(message);
}

// navigator.clipboard needs a secure context and can still throw (permissions,
// an insecure iframe, older browsers); fall back to the classic hidden-textarea
// trick rather than leaving the editor with no way to get the prompt at all.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function describeInbox(row: InboxRow): string {
  const parts: string[] = [];
  if (row.date) parts.push(fmtDate(row.date));
  if (row.receivedAt) parts.push(`received ${timeAgo(row.receivedAt)}`);
  if (typeof row.words === "number" && row.words > 0) parts.push(`${row.words.toLocaleString()} words`);
  if (row.preacher) parts.push(row.preacher);
  return parts.join(" · ");
}

export default function Page() {
  const [passcode, setPasscode] = useState("");
  const [mode, setMode] = useState<Mode>("paste");
  const [stage, setStage] = useState<Stage>("input");
  const [meta, setMeta] = useState<Meta>({
    series: "",
    part: "",
    date: "",
    preacher: "",
    scripture: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ liveUrl: string; slug: string } | null>(null);
  const [guides, setGuides] = useState<GuideRef[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [inboxBusy, setInboxBusy] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [transcriptSource, setTranscriptSource] = useState<string | null>(null);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  // Set only when onGenerate's own API call fails, so the "fill in by hand"
  // callout doesn't also show up for unrelated errors (bad passcode, etc.).
  const [genFailed, setGenFailed] = useState(false);
  // One level of undo. Regenerating replaces every field, so without this a
  // stray click loses whatever the editor had already fixed by hand.
  const [undoDraft, setUndoDraft] = useState<Draft | null>(null);
  // Markdown mode: `draft`/`meta` stay the source of truth. `markdownText` is a
  // staging area, only merged back into them when switching to Fields — so
  // Publish/Regenerate, which read `draft` directly, never see unapplied edits.
  const [viewMode, setViewMode] = useState<"fields" | "markdown">("fields");
  const [markdownText, setMarkdownText] = useState("");
  const [markdownError, setMarkdownError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("studio_passcode");
    if (saved) {
      setPasscode(saved);
      // Silently unlock if the saved passcode is still valid.
      fetch("/api/auth", { headers: { "x-app-passcode": saved } })
        .then((res) => {
          if (res.ok) {
            setAuthed(true);
            void loadGuides(saved);
            void loadInbox(saved);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unlock() {
    const pass = passcode.trim();
    if (!pass) return setError("Enter the passcode.");
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/auth", { headers: { "x-app-passcode": pass } });
      if (res.ok) {
        localStorage.setItem("studio_passcode", pass);
        setAuthed(true);
        void loadGuides(pass);
        void loadInbox(pass);
      } else {
        setError("Incorrect passcode.");
      }
    } catch {
      setError("Could not verify the passcode. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function loadGuides(pass: string) {
    try {
      const res = await fetch("/api/guides", { headers: { "x-app-passcode": pass } });
      if (res.ok) {
        const data = await res.json();
        setGuides(data.guides || []);
      }
    } catch {
      /* non-critical */
    }
  }

  async function loadInbox(pass: string) {
    try {
      const res = await fetch("/api/inbox", { headers: { "x-app-passcode": pass } });
      if (res.ok) {
        const data = await res.json();
        setInbox(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      /* non-critical */
    }
  }

  // Pull a delivered transcript into the form. Fills the transcript box and any
  // metadata that came with it; the leader still sets Series/Part.
  async function useInboxItem(row: InboxRow) {
    setError(null);
    setInboxBusy(row.id);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(row.id)}`, {
        headers: { "x-app-passcode": passcode },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load that transcript");
      setMode("paste");
      // Inbox items arrive as raw WebVTT. Without this the timestamps and cue
      // numbers go straight to Gemini and fill the transcript box with noise.
      setTranscript(typeof data.vtt === "string" ? parseTranscript(data.vtt) : "");
      setTranscriptSource(null);
      const m = (data.meta ?? {}) as { date?: string; preacher?: string };
      setMeta((prev) => ({
        ...prev,
        date: prev.date || m.date || "",
        preacher: prev.preacher || m.preacher || "",
      }));
      setInboxId(row.id);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that transcript");
    } finally {
      setInboxBusy(null);
    }
  }

  // Delete a delivered transcript without publishing it.
  async function deleteInboxItem(row: InboxRow) {
    if (!window.confirm(`Delete "${row.title}"? It will be removed from the inbox.`)) return;
    setError(null);
    setInboxBusy(row.id);
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { "x-app-passcode": passcode },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete that transcript");
      setInbox((list) => list.filter((it) => it.id !== row.id));
      if (inboxId === row.id) setInboxId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that transcript");
    } finally {
      setInboxBusy(null);
    }
  }

  // Read a .vtt/.srt/.txt into the transcript box. Parsing client-side keeps the
  // generate path untouched — by the time we submit, this is indistinguishable
  // from a pasted transcript.
  async function onTranscriptFile(f: File | null) {
    if (!f) return;
    setError(null);
    if (f.size > MAX_TRANSCRIPT_BYTES) {
      return setError(
        `That file is ${(f.size / (1024 * 1024)).toFixed(1)} MB. Transcripts should be under ${
          MAX_TRANSCRIPT_BYTES / (1024 * 1024)
        } MB — if you meant to upload audio, use the Upload audio tab.`,
      );
    }
    try {
      const raw = await f.text();
      const text = parseTranscript(raw);
      if (!text.trim()) {
        return setError(`No transcript text found in "${f.name}".`);
      }
      setTranscript(text);
      setInboxId(null);
      setTranscriptSource(
        `${f.name} — ${wordCount(text).toLocaleString()} words${
          looksLikeCaptions(raw) ? ", timestamps removed" : ""
        }`,
      );
      // Show what was loaded so it can be checked and edited before generating.
      setMode("paste");
    } catch {
      setError(`Could not read "${f.name}". Make sure it's a text file, not a PDF or Word doc.`);
    }
  }

  const setMetaField = (k: keyof Meta, v: string) => setMeta((m) => ({ ...m, [k]: v }));
  const setDraftField = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  function metaOut() {
    return {
      series: meta.series.trim(),
      part: meta.part.trim() || undefined,
      date: meta.date || undefined,
      preacher: meta.preacher.trim() || undefined,
      scripture_title: meta.scripture.trim() || undefined,
      scripture_ref: meta.scripture.trim() || undefined,
    };
  }

  function contentOut() {
    const dq: Record<string, string[]> = {};
    const add = (name: string, v: string) => {
      const list = lines(v);
      if (list.length) dq[name] = list;
    };
    add("Connecting", draft.connecting);
    add("Considering", draft.considering);
    add("Confessing", draft.confessing);
    add("Committing", draft.committing);
    return {
      recap: paras(draft.recap),
      one_thing: draft.one_thing.trim(),
      discussion_questions: dq,
      next_steps: lines(draft.next_steps),
      next_steps_intro: draft.next_steps_intro.trim() || undefined,
      next_steps_title: draft.next_steps_title.trim() || undefined,
    };
  }

  function guideToDraft(g: Record<string, unknown>): Draft {
    const dq = (g.discussion_questions || {}) as Record<string, string[]>;
    const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
    return {
      recap: list(g.recap).join("\n\n"),
      one_thing: typeof g.one_thing === "string" ? g.one_thing : "",
      connecting: getCat(dq, "Connecting").join("\n"),
      considering: getCat(dq, "Considering").join("\n"),
      confessing: getCat(dq, "Confessing").join("\n"),
      committing: getCat(dq, "Committing").join("\n"),
      next_steps_intro: typeof g.next_steps_intro === "string" ? g.next_steps_intro : "",
      next_steps_title: typeof g.next_steps_title === "string" ? g.next_steps_title : "",
      next_steps: list(g.next_steps).join("\n"),
    };
  }

  function fillDraft(g: Record<string, unknown>) {
    setDraft(guideToDraft(g));
  }

  // Serialize the current draft/meta into the markdown box. Fields stay the
  // source of truth, so this always wins over whatever was in the box before.
  function enterMarkdownMode() {
    setMarkdownText(draftToMarkdown(meta, draft));
    setMarkdownError(null);
    setViewMode("markdown");
  }

  // Parse the markdown box and merge it back into draft/meta, then switch to
  // Fields. Blocks (stays in Markdown) on a hard parse error, and confirms
  // before applying anything that would drop content, so switching back and
  // forth never silently loses text.
  function applyMarkdownAndReturnToFields() {
    const parsed = parseGuideMarkdown(markdownText);
    if (!parsed.ok) {
      setMarkdownError(parsed.error);
      return;
    }
    setMarkdownError(null);

    if (parsed.isBlank) {
      const hasExisting = !isDraftEmpty(draft) || !isMetaEmpty(meta);
      if (
        hasExisting &&
        !window.confirm("The markdown box is empty. Switching back will clear the guide fields. Continue?")
      ) {
        return;
      }
      setDraft((d) => ({ ...EMPTY_DRAFT, next_steps_title: d.next_steps_title }));
      setViewMode("fields");
      return;
    }

    if (parsed.warnings.length) {
      const proceed = window.confirm(
        `Some content couldn't be imported and will be lost if you continue:\n\n${parsed.warnings.join("\n")}\n\nSwitch to Fields anyway?`,
      );
      if (!proceed) return;
    }

    setDraft((d) => ({ ...parsed.draft, next_steps_title: d.next_steps_title }));
    setMeta((m) => ({
      ...m,
      series: parsed.meta.series,
      part: parsed.meta.part,
      date: parsed.meta.date ?? m.date,
      preacher: parsed.meta.preacher ?? m.preacher,
      scripture: parsed.meta.scripture ?? m.scripture,
    }));
    setViewMode("fields");
  }

  // Abandon whatever is in the markdown box (e.g. it won't parse and the
  // editor would rather start over) without touching draft/meta.
  function discardMarkdownEdits() {
    setMarkdownError(null);
    setViewMode("fields");
  }

  function validate(): string | null {
    if (!passcode) return "Enter the passcode first.";
    if (!meta.series.trim()) return "Series is required.";
    if (mode === "audio" && !file) return "Choose an audio file.";
    if (mode === "file" && !transcript.trim()) return "Choose a transcript file first.";
    if (mode === "paste" && !transcript.trim()) return "Paste a transcript first.";
    return null;
  }

  async function onGenerate() {
    const v = validate();
    if (v) return setError(v);
    setError(null);
    setGenFailed(false);
    setTranscriptFailed(false);
    setViewMode("fields");
    setMarkdownError(null);
    setStage("working");

    try {
      let payload: Record<string, unknown>;
      if (mode === "audio" && file) {
        setWorking("Uploading audio…");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: passcode,
          contentType: file.type || "audio/mpeg",
        });
        setWorking("Generating guide and transcript… (this can take a minute)");
        payload = { blobUrl: blob.url, mimeType: file.type || "audio/mp3", meta: metaOut() };
      } else {
        setWorking("Generating the guide…");
        payload = { transcript, meta: metaOut() };
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-passcode": passcode },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      fillDraft(data.guide || {});
      if (typeof data.transcript === "string") setTranscript(data.transcript);
      setTranscriptFailed(Boolean(data.transcriptFailed));
      setStage("review");
    } catch (e) {
      setStage("input");
      setGenFailed(true);
      const message = e instanceof Error ? e.message : "Generation failed";
      setError(
        isRateLimitError(message)
          ? "Gemini's free-tier limit was hit. Wait a bit and try again, or fill in the guide yourself below."
          : message,
      );
    }
  }

  // Skip Gemini entirely and drop straight into the editable review form, e.g.
  // when the free API limit is blocking generation. Meta stays as already
  // entered; the transcript (if any) is kept but nothing requires it — the
  // revise card already handles a missing transcript.
  function startManual() {
    setError(null);
    setGenFailed(false);
    setTranscriptFailed(false);
    setViewMode("fields");
    setMarkdownError(null);
    setStage("review");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Copies the standalone generation prompt (plus the pasted transcript, if
  // there is one) so it can be run in an outside AI when Gemini isn't an
  // option, then pasted back in via Markdown mode.
  async function copyExternalPrompt() {
    const text = transcript.trim()
      ? `${EXTERNAL_AI_PROMPT}\n\n--- SERMON TRANSCRIPT ---\n\n${transcript.trim()}`
      : EXTERNAL_AI_PROMPT;
    const ok = await copyToClipboard(text);
    if (ok) {
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } else {
      setError("Couldn't copy to the clipboard. Check your browser's clipboard permissions and try again.");
    }
  }

  // Send the draft as it currently stands, edits included, so Gemini revises it
  // rather than generating a fresh guide from the transcript.
  async function onRegenerate() {
    const notes = revisionNotes.trim();
    if (!notes) return setError("Describe the changes you want first.");
    if (!transcript.trim()) {
      return setError("There's no transcript to regenerate from.");
    }
    setError(null);
    setRegenerating(true);
    const before = draft;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-passcode": passcode },
        body: JSON.stringify({
          transcript,
          meta: metaOut(),
          revisionNotes: notes,
          previousGuide: contentOut(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");
      const next = guideToDraft(data.guide || {});
      setDraft(next);
      setUndoDraft(before);
      // Regenerate button is disabled in Markdown mode, but stay defensive:
      // Undo (below) can still land here, so keep the box from going stale.
      if (viewMode === "markdown") setMarkdownText(draftToMarkdown(meta, next));
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  }

  function undoRegenerate() {
    if (!undoDraft) return;
    setDraft(undoDraft);
    if (viewMode === "markdown") setMarkdownText(draftToMarkdown(meta, undoDraft));
    setUndoDraft(null);
  }

  async function onPublish(confirmOverwrite = false) {
    setError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-app-passcode": passcode },
        body: JSON.stringify({
          meta: metaOut(),
          content: contentOut(),
          transcript,
          confirmOverwrite,
          inboxId: mode === "paste" ? inboxId ?? undefined : undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsConfirm) {
        const ok = window.confirm(`${data.message} Overwrite it?`);
        setPublishing(false);
        if (ok) await onPublish(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Publish failed");
      setResult({ liveUrl: data.liveUrl, slug: data.slug });
      setInboxId(null);
      void loadGuides(passcode);
      void loadInbox(passcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  function reset() {
    setStage("input");
    setMeta({ series: "", part: "", date: "", preacher: "", scripture: "" });
    setFile(null);
    setTranscript("");
    setTranscriptFailed(false);
    setDraft(EMPTY_DRAFT);
    setResult(null);
    setError(null);
    setInboxId(null);
    setTranscriptSource(null);
    setRevisionNotes("");
    setUndoDraft(null);
    setGenFailed(false);
    setViewMode("fields");
    setMarkdownText("");
    setMarkdownError(null);
  }

  const slug = meta.series.trim() ? slugify(`${meta.series} ${meta.part}`.trim()) : "";

  if (!authed) {
    return (
      <div className="wrap">
        <h1>Sermon Guide Studio</h1>
        <p className="sub">Enter the passcode to continue.</p>
        {error && <div className="error">{error}</div>}
        <div className="card">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Passcode</label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlock();
              }}
              placeholder="Shared passcode"
              autoFocus
            />
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <button onClick={() => void unlock()} disabled={checking}>
              {checking && <span className="spinner" />}
              {checking ? "Checking…" : "Unlock"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>Sermon Guide Studio</h1>
      <p className="sub">Upload a sermon, review the generated guide, and publish it live.</p>

      {error && (
        <div className="error">
          {error}
          {genFailed && stage === "input" && (
            <div style={{ marginTop: 10 }}>
              <button className="secondary" onClick={startManual}>
                Fill in the guide by hand instead
              </button>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="ok">
          <strong>Published.</strong> <code>{result.slug}</code> will be live shortly at{" "}
          <a href={result.liveUrl} target="_blank" rel="noreferrer">
            {result.liveUrl}
          </a>
          <div style={{ marginTop: 10 }}>
            <button className="secondary" onClick={reset}>
              Start another
            </button>
          </div>
        </div>
      )}

      {!result && stage === "input" && (
        <>
          {inbox.length > 0 && (
            <div className="card">
              <div className="inbox-head">
                <label style={{ margin: 0 }}>Waiting from SermonClipper</label>
                <span className="inbox-count">{inbox.length} available</span>
              </div>
              <div className="inbox-list">
                {inbox.map((row) => (
                  <div
                    key={row.id}
                    className={inboxId === row.id ? "inbox-item current" : "inbox-item"}
                  >
                    <div className="inbox-meta">
                      <div className="t">{row.title}</div>
                      {describeInbox(row) && <div className="d">{describeInbox(row)}</div>}
                    </div>
                    <button
                      className="secondary"
                      onClick={() => void deleteInboxItem(row)}
                      disabled={inboxBusy !== null}
                    >
                      Delete
                    </button>
                    <button onClick={() => void useInboxItem(row)} disabled={inboxBusy !== null}>
                      {inboxBusy === row.id && <span className="spinner" />}
                      {inboxId === row.id ? "Loaded" : "Use this"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Picking one loads its transcript below and fills the date. Delete removes it without
                publishing.
              </p>
            </div>
          )}

          <div className="card">
            <div className="tabs">
              <button
                className={mode === "audio" ? "tab active" : "tab"}
                onClick={() => setMode("audio")}
              >
                Upload audio
              </button>
              <button
                className={mode === "file" ? "tab active" : "tab"}
                onClick={() => setMode("file")}
              >
                Transcript file
              </button>
              <button
                className={mode === "paste" ? "tab active" : "tab"}
                onClick={() => setMode("paste")}
              >
                Paste transcript
                {inbox.length > 0 && <span className="tab-badge">{inbox.length}</span>}
              </button>
            </div>

            <div className="row">
              <div className="field">
                <label>Series *</label>
                <input
                  type="text"
                  value={meta.series}
                  onChange={(e) => setMetaField("series", e.target.value)}
                  placeholder="ADORE"
                />
              </div>
              <div className="field">
                <label>Part</label>
                <input
                  type="text"
                  value={meta.part}
                  onChange={(e) => setMetaField("part", e.target.value)}
                  placeholder="Part 5: Worship With Presence"
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>
                  Date <span className="hint">— defaults to today</span>
                </label>
                <input
                  type="date"
                  value={meta.date}
                  onChange={(e) => setMetaField("date", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Preacher</label>
                <input
                  type="text"
                  value={meta.preacher}
                  onChange={(e) => setMetaField("preacher", e.target.value)}
                  placeholder="Pastor Pete Dahlem"
                />
              </div>
            </div>
            <div className="field">
              <label>
                Scripture reference{" "}
                <span className="hint">— e.g. Luke 2:1-20 (passage text filled by the site)</span>
              </label>
              <input
                type="text"
                value={meta.scripture}
                onChange={(e) => setMetaField("scripture", e.target.value)}
                placeholder="Luke 2:1-20"
              />
            </div>
            {slug && (
              <p className="muted">
                Will publish as <code>content/{slug}.yaml</code>
              </p>
            )}
          </div>

          <div className="card">
            {mode === "audio" ? (
              <div className="field">
                <label>
                  Audio file <span className="hint">— mp3 recommended (also m4a, wav)</span>
                </label>
                <input
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="muted">
                    {file.name} — {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
              </div>
            ) : mode === "file" ? (
              <div className="field">
                <label>
                  Transcript file <span className="hint">— .vtt, .srt or .txt</span>
                </label>
                <input
                  type="file"
                  accept={TRANSCRIPT_ACCEPT}
                  onChange={(e) => void onTranscriptFile(e.target.files?.[0] ?? null)}
                />
                <p className="muted">
                  Subtitle files have their timestamps and cue numbers stripped. The text lands in
                  Paste transcript so you can check it before generating.
                </p>
              </div>
            ) : (
              <div className="field">
                <label>
                  Transcript
                  {inboxId && <span className="hint"> — loaded from the inbox</span>}
                  {!inboxId && transcriptSource && <span className="hint"> — from a file</span>}
                </label>
                {transcriptSource && !inboxId && (
                  <p className="muted">{transcriptSource}</p>
                )}
                <AutoTextarea
                  className="ta-lg"
                  value={transcript}
                  onValueChange={setTranscript}
                  placeholder="Paste the sermon transcript here…"
                />
              </div>
            )}
            <div className="actions">
              <button onClick={onGenerate}>Generate guide</button>
              <button className="secondary" onClick={startManual}>
                Write it myself
              </button>
              <button className="secondary" onClick={() => void copyExternalPrompt()}>
                {promptCopied ? "Copied!" : "Copy prompt for another AI"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Hitting Gemini&apos;s free API limit? &quot;Write it myself&quot; opens the same
              editable fields without calling Gemini. &quot;Copy prompt for another AI&quot;
              copies a ready-to-run generation prompt{transcript.trim() ? " with your transcript" : ""}{" "}
              — paste it into ChatGPT, Claude, or another AI, then paste the markdown it gives back
              into Markdown mode after clicking &quot;Write it myself&quot;.
            </p>
          </div>

          {guides.length > 0 && (
            <div className="card">
              <label>Published guides</label>
              <div className="chips">
                {guides.map((g) => (
                  <a key={g.slug} className="chip" href={g.url} target="_blank" rel="noreferrer">
                    {g.slug}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!result && stage === "working" && (
        <div className="card">
          <span className="spinner" />
          {working}
        </div>
      )}

      {!result && stage === "review" && (
        <>
          {transcriptFailed && (
            <div className="warn">
              The transcript couldn&apos;t be generated, but the guide is ready. You can still publish
              (no transcript will be saved), or go back and try again.
            </div>
          )}

          <div className="card revise">
            <Field label="Ask for changes">
              <AutoTextarea
                className="ta-md"
                value={revisionNotes}
                onValueChange={setRevisionNotes}
                disabled={regenerating}
                placeholder={
                  "Describe what you want different, in your own words. For example:\n\n" +
                  "Make the recap warmer and cut the third paragraph down. The Connecting " +
                  "questions are too personal, keep them light. Add a next step about " +
                  "inviting someone to Life Group."
                }
              />
            </Field>
            <p className="muted">
              Rewrites the draft below with these changes, keeping everything you haven&apos;t
              asked to change, including your own edits.
            </p>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => void onRegenerate()}
                disabled={
                  regenerating ||
                  publishing ||
                  !revisionNotes.trim() ||
                  !transcript.trim() ||
                  viewMode === "markdown"
                }
              >
                {regenerating && <span className="spinner" />}
                {regenerating ? "Regenerating…" : "Regenerate draft"}
              </button>
              {undoDraft && !regenerating && (
                <button className="secondary" onClick={undoRegenerate}>
                  Undo
                </button>
              )}
            </div>
            {!transcript.trim() && (
              <p className="muted">
                Regenerating needs the transcript, which isn&apos;t available for this guide. Edit
                the fields below by hand, or go back and try again.
              </p>
            )}
            {viewMode === "markdown" && (
              <p className="muted">Switch to Fields to regenerate.</p>
            )}
          </div>

          <div className="card">
            <div className="tabs">
              <button
                className={viewMode === "fields" ? "tab active" : "tab"}
                onClick={() => {
                  if (viewMode !== "fields") applyMarkdownAndReturnToFields();
                }}
              >
                Fields
              </button>
              <button
                className={viewMode === "markdown" ? "tab active" : "tab"}
                onClick={() => {
                  if (viewMode !== "markdown") enterMarkdownMode();
                }}
              >
                Markdown
              </button>
            </div>

            {viewMode === "markdown" && (
              <>
                {markdownError && (
                  <div className="error">
                    {markdownError}
                    <div style={{ marginTop: 8 }}>
                      <button className="secondary" onClick={discardMarkdownEdits}>
                        Discard these edits and go back to Fields
                      </button>
                    </div>
                  </div>
                )}
                <Field label="Full guide (markdown)">
                  <AutoTextarea
                    className="ta-lg"
                    value={markdownText}
                    onValueChange={(v) => {
                      setMarkdownText(v);
                      setMarkdownError(null);
                    }}
                  />
                </Field>
                <p className="muted">
                  Edits here apply to the fields when you switch back to Fields — Regenerate and
                  Publish always use the Fields version. First line sets Series / Part, e.g.{" "}
                  <code># ADORE — Part 5: Worship With Joy</code>; Date, Scripture, and Preacher
                  lines are optional. Anything that doesn&apos;t match this format is flagged
                  before it&apos;s applied, so nothing is silently dropped.
                </p>
              </>
            )}
          </div>

          {viewMode === "fields" && (
            <>
              <div className="card">
                <Field label="Recap (paragraphs, blank line between)">
                  <AutoTextarea
                    className="ta-md"
                    value={draft.recap}
                    onValueChange={(v) => setDraftField("recap", v)}
                  />
                </Field>
                <Field label="One thing">
                  <input
                    type="text"
                    value={draft.one_thing}
                    onChange={(e) => setDraftField("one_thing", e.target.value)}
                  />
                </Field>
              </div>

              <div className="card">
                <label style={{ marginBottom: 12 }}>Discussion questions (one per line)</label>
                <Field label="Connecting">
                  <AutoTextarea
                    value={draft.connecting}
                    onValueChange={(v) => setDraftField("connecting", v)}
                  />
                </Field>
                <Field label="Considering">
                  <AutoTextarea
                    value={draft.considering}
                    onValueChange={(v) => setDraftField("considering", v)}
                  />
                </Field>
                <Field label="Confessing">
                  <AutoTextarea
                    value={draft.confessing}
                    onValueChange={(v) => setDraftField("confessing", v)}
                  />
                </Field>
                <Field label="Committing">
                  <AutoTextarea
                    value={draft.committing}
                    onValueChange={(v) => setDraftField("committing", v)}
                  />
                </Field>
              </div>

              <div className="card">
                <Field label="Next steps intro (optional)">
                  <input
                    type="text"
                    value={draft.next_steps_intro}
                    onChange={(e) => setDraftField("next_steps_intro", e.target.value)}
                  />
                </Field>
                <Field label="Next steps (one per line)">
                  <AutoTextarea
                    value={draft.next_steps}
                    onValueChange={(v) => setDraftField("next_steps", v)}
                  />
                </Field>
              </div>

              <Preview meta={meta} draft={draft} />

              {slug && (
                <p className="muted" style={{ marginTop: 12 }}>
                  Publishing to <code>content/{slug}.yaml</code>
                  {transcript.trim() ? ` and transcripts/${slug}.md` : ""}.
                </p>
              )}
            </>
          )}

          <div className="actions actions-sticky" style={{ marginTop: 8 }}>
            <button onClick={() => onPublish(false)} disabled={publishing || viewMode === "markdown"}>
              {publishing && <span className="spinner" />}
              {publishing ? "Publishing…" : "Approve & publish"}
            </button>
            <button className="secondary" onClick={() => setStage("input")} disabled={publishing}>
              Back
            </button>
          </div>
          {viewMode === "markdown" && (
            <p className="muted" style={{ marginTop: 8 }}>
              Switch to Fields to publish.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Preview({ meta, draft }: { meta: Meta; draft: Draft }) {
  const cats: [string, string][] = [
    ["Connecting", draft.connecting],
    ["Considering", draft.considering],
    ["Confessing", draft.confessing],
    ["Committing", draft.committing],
  ];
  return (
    <div className="preview">
      <p className="series">{meta.series || "Series"}</p>
      {meta.part && <p className="part">{meta.part}</p>}
      {meta.scripture && <p className="muted">{meta.scripture}</p>}

      {paras(draft.recap).length > 0 && (
        <>
          <h2>Sermon Recap</h2>
          {paras(draft.recap).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </>
      )}
      {draft.one_thing.trim() && <p className="one-thing">{draft.one_thing}</p>}

      {cats.some(([, v]) => lines(v).length > 0) && (
        <>
          <h2>Discussion Questions</h2>
          {cats.map(([name, v]) =>
            lines(v).length ? (
              <div key={name}>
                <p className="dq-cat">{name}</p>
                <ul>
                  {lines(v).map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </>
      )}

      {lines(draft.next_steps).length > 0 && (
        <>
          <h2>Next Steps</h2>
          {draft.next_steps_intro.trim() && <p>{draft.next_steps_intro}</p>}
          <ol>
            {lines(draft.next_steps).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
