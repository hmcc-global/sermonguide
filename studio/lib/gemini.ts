import { GoogleGenAI, FileState, createPartFromUri, type Part } from "@google/genai";
import type { GuideMeta, GuideContent } from "@/lib/guide";

// Rolling alias that tracks the current Flash model, overridable without a code change.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const INSTRUCTIONS = `You create a sermon recap and small-group Bible study guide for HMCC (Harvest Mission Community Church). The output must read like a thoughtful church member who listened closely to THIS sermon, never generic and never like AI-generated text.

The title, date, scripture, and preacher are handled separately, so you write ONLY these four sections as a JSON object:
{
  "recap": string[],            // exactly 4 paragraphs (one string per paragraph)
  "one_thing": string,          // the single biggest takeaway, in one sentence
  "discussion_questions": {     // exactly 2 questions per category
    "Connecting": string[],
    "Considering": string[],
    "Confessing": string[],
    "Committing": string[]
  },
  "next_steps": string[]        // exactly 3 concrete action items
}

RECAP — EXACTLY 4 paragraphs, 350-450 words TOTAL. Never write a 5th paragraph and never exceed 450 words:
- A warm, clear narrative, like explaining the sermon to a friend who missed Sunday. Not bullets, not an outline.
- Say "Pastor [Firstname]" every time you name the speaker (e.g., "Pastor Josh"). Never bare "Josh", never "the pastor."
- Rough shape: (1) the series and how the preacher framed the book/passage; (2) and (3) walking through the passage, its imagery and interpretation, and the main points with their key illustrations; (4) the central application and conclusion.
- Be RUTHLESS about length: keep only the most memorable illustrations and cut the rest to stay within 4 paragraphs and 450 words. Include Scripture references (e.g., "Song of Songs 4:12-5:1") but paraphrase; never reproduce the full passage text (the site adds it).

ONE THING: The sermon's core takeaway as a single sentence. If the speaker stated a "one thing" or bottom line, use it; otherwise distill one.

WRITING STYLE (this is what separates a good guide from an AI-sounding one):
- DO NOT use em dashes anywhere. They are the top tell of AI writing. Use commas, periods, or restructure. If you reach for an em dash, rewrite the sentence.
- Church-bulletin reading level, not seminary. No academic or heavy theological language.
- Write like a person: vary sentence length, let some sentences be short, do not over-qualify.
- AVOID these AI hallmarks: transitional hype ("the second half turns urgent", "sobering territory"); commentary on the pastor's delivery or skill ("Pastor X got personal here", "made the point plainly", "found real treasure in it") — use neutral framing like "Pastor X reminded us that...", "noted that...", "shared from his own life..."; dramatic parallel sentence pairs; repeated "X and Y" couplets ("truth and love" over and over); throat-clearing openers ("This week, Pastor X turned to..."); filler affirmations ("a powerful reminder", "a striking question"); meta-commentary on the sermon's structure.

DISCUSSION QUESTIONS (exactly 2 per category). HARD RULES for EVERY question:
- ONE sentence, roughly 10-25 words. Never compound: no "and how...", no second question mark, no "Explain." at the end. Ask exactly one thing.
- NEVER name the speaker ("Pastor Josh", "Josh") or cite scholars/quotes in a question. Questions are for the group to answer, not a recap of the sermon.
- Connecting: lighthearted and IMPERSONAL. Anyone can answer without sharing anything personal or vulnerable, and without having heard the sermon. (Good: "What comes to mind when you hear the phrase 'God's design for sex'?")
- Considering: about the Scripture TEXT only. Point to the passage; ask what it says, pictures, warns, or commands. Never mention the pastor, the sermon, or scholars. (Good: "In Song of Songs 4:12-15, what does the locked-garden imagery suggest about the relationship?")
- Confessing: one honest, inward question about where this hits home. (Good: "Where do you fear that being fully known would make you less loved?")
- Committing: one specific, doable step ("Who is one person...", "What is one step this week..."). Never vague like "How can you be better?"
Example of a BAD question (too long, compound, names the pastor) -> its FIX:
BAD: "Pastor Josh shared his fear of opening up to his wife on the drive from Chicago because of his past sins. In what areas of your life do you hide behind emotional barriers out of fear that your shame will be exposed?"
FIX: "Where do you hide behind emotional barriers for fear your shame would be exposed?"

NEXT STEPS (exactly 3): practical action items drawn directly from the sermon, each one short line. If the pastor gave explicit challenges or action steps, use those rather than inventing new ones.

EDGE CASES: If the transcript is messy, clean it up and ignore filler and tangents. If no clear passage, focus on the themes and ask Considering questions about the principles instead of a specific text.

Base everything strictly on the sermon provided. Do NOT invent quotes, scripture, statistics, or stories the preacher did not give. Output valid JSON only. No markdown, no commentary, no code fences.`;

const TRANSCRIBE_PROMPT = `Transcribe this sermon audio verbatim into clean, readable paragraphs.
Include all spoken content. Do not summarize, add headings, timestamps, speaker labels, or commentary.
Output plain text only.`;

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

function guidePrompt(meta: GuideMeta): string {
  const context = [
    meta.series ? `Series: ${meta.series}` : "",
    meta.part ? `Part: ${meta.part}` : "",
    meta.scripture_title ? `Scripture: ${meta.scripture_title}` : "",
    meta.preacher ? `Preacher: ${meta.preacher}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${INSTRUCTIONS}\n\n--- SERMON CONTEXT ---\n${context}`;
}

// ---- Phase 1: pasted transcript -> guide (non-streaming; small, fast) ----

export async function generateGuideFromTranscript(
  transcript: string,
  meta: GuideMeta,
): Promise<GuideContent> {
  const ai = client();
  const prompt = `${guidePrompt(meta)}\n\n--- TRANSCRIPT ---\n${transcript}`;
  return withRetry(async () => {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
        temperature: 0.4,
      },
    });
    const raw = res.text;
    if (!raw) throw new Error("Gemini returned an empty response");
    return parseGuide(raw);
  });
}

// ---- Phase 2: audio -> { guide, transcript } ----

export type AudioResult = {
  guide: GuideContent;
  transcript: string | null;
  transcriptFailed: boolean;
};

export async function generateFromAudio(
  audioBytes: ArrayBuffer,
  mimeType: string,
  meta: GuideMeta,
): Promise<AudioResult> {
  const ai = client();
  const file = await uploadAndWait(ai, audioBytes, mimeType);
  const audioPart = createPartFromUri(file.uri as string, file.mimeType as string);

  // Guide is the critical artifact — let it throw if it fails.
  const guide = await streamGuide(ai, audioPart, meta);

  // Transcript is best-effort — never let its failure lose the guide.
  let transcript: string | null = null;
  let transcriptFailed = false;
  try {
    transcript = await streamTranscript(ai, audioPart);
  } catch {
    transcriptFailed = true;
  }

  // Clean up the Gemini-side file (it would auto-expire in 48h anyway).
  try {
    if (file.name) await ai.files.delete({ name: file.name });
  } catch {
    /* best effort */
  }

  return { guide, transcript, transcriptFailed };
}

async function uploadAndWait(ai: GoogleGenAI, bytes: ArrayBuffer, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  let file = await ai.files.upload({ file: blob, config: { mimeType } });

  const deadline = Date.now() + 120_000;
  while (file.state === FileState.PROCESSING && Date.now() < deadline) {
    await sleep(2000);
    if (!file.name) break;
    file = await ai.files.get({ name: file.name });
  }

  if (file.state === FileState.FAILED) {
    throw new Error("Gemini failed to process the audio file");
  }
  if (!file.uri || !file.mimeType) {
    throw new Error("Gemini did not return a usable file URI (audio may still be processing)");
  }
  return file;
}

async function streamGuide(
  ai: GoogleGenAI,
  audioPart: Part,
  meta: GuideMeta,
): Promise<GuideContent> {
  return withRetry(async () => {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: guidePrompt(meta) }, audioPart] }],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 32768,
        temperature: 0.4,
      },
    });
    let text = "";
    for await (const chunk of stream) {
      if (chunk.text) text += chunk.text;
    }
    if (!text.trim()) throw new Error("Gemini returned an empty guide");
    return parseGuide(text);
  });
}

async function streamTranscript(ai: GoogleGenAI, audioPart: Part): Promise<string> {
  const stream = await ai.models.generateContentStream({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: TRANSCRIBE_PROMPT }, audioPart] }],
    config: {
      maxOutputTokens: 65536,
      temperature: 0,    },
  });
  let text = "";
  for await (const chunk of stream) {
    if (chunk.text) text += chunk.text;
  }
  if (!text.trim()) throw new Error("Empty transcript");
  return text.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Retry a flaky generation (empty/invalid JSON, transient API error) a couple of times.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Generation failed");
}

// ---- Shared JSON parsing ----

function parseGuide(raw: string): GuideContent {
  const obj = extractJsonObject(raw);
  if (!obj) throw new Error("Gemini did not return valid JSON");

  const asStringList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

  const dqRaw = (obj.discussion_questions ?? {}) as Record<string, unknown>;
  const discussion_questions: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(dqRaw)) {
    const list = asStringList(v);
    if (list.length) discussion_questions[k] = list;
  }

  const guide: GuideContent = {
    recap: asStringList(obj.recap),
    one_thing: typeof obj.one_thing === "string" ? obj.one_thing.trim() : "",
    discussion_questions,
    next_steps: asStringList(obj.next_steps),
    next_steps_intro:
      typeof obj.next_steps_intro === "string" ? obj.next_steps_intro.trim() : undefined,
    next_steps_title:
      typeof obj.next_steps_title === "string" ? obj.next_steps_title.trim() : undefined,
  };

  // Treat an empty result as a failure so withRetry can try again.
  if (!guide.recap.length && !Object.keys(guide.discussion_questions).length) {
    throw new Error("Gemini did not return valid JSON");
  }
  return guide;
}

// Pull a JSON object out of the model text, tolerating code fences or stray prose.
function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  const direct = safeJsonObject(text);
  if (direct) return direct;

  // Fall back to the outermost { ... } span if the model added text around it.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return safeJsonObject(text.slice(start, end + 1));
  }
  return null;
}

function safeJsonObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
