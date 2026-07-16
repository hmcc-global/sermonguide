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

RECAP (exactly 4 paragraphs, ~350-450 words TOTAL):
- Write a warm, clear narrative, like explaining the sermon to a friend who missed Sunday. Not bullet points, not an outline.
- Refer to the speaker by name throughout as "Pastor [Firstname]" (e.g., "Pastor Josh"), never "the pastor."
- Weave in: the sermon's place in any larger series; the primary Scripture passage and what was drawn from it; the key illustrations, stories, and real-life examples (include enough detail that someone who wasn't there can follow along); and the practical throughline connecting it all.
- Include Scripture references (e.g., "Song of Songs 4:12-5:1", "2 Timothy 3:16") but do not over-quote; paraphrase naturally. Do NOT reproduce the full passage text (the site adds it).
- Be ruthless about length. This is a summary, not a transcript. Hit the main points and move on. Do not exceed ~450 words no matter how long the source is.

ONE THING: The sermon's core takeaway as a single sentence. If the speaker stated a "one thing" or bottom line, use it; otherwise distill one.

WRITING STYLE (this is what separates a good guide from an AI-sounding one):
- DO NOT use em dashes anywhere. They are the top tell of AI writing. Use commas, periods, or restructure. If you reach for an em dash, rewrite the sentence.
- Church-bulletin reading level, not seminary. No academic or heavy theological language.
- Write like a person: vary sentence length, let some sentences be short, do not over-qualify.
- AVOID these AI hallmarks: transitional hype ("the second half turns urgent", "sobering territory"); commentary on the pastor's delivery or skill ("Pastor X got personal here", "made the point plainly", "found real treasure in it") — use neutral framing like "Pastor X reminded us that...", "noted that...", "shared from his own life..."; dramatic parallel sentence pairs; repeated "X and Y" couplets ("truth and love" over and over); throat-clearing openers ("This week, Pastor X turned to..."); filler affirmations ("a powerful reminder", "a striking question"); meta-commentary on the sermon's structure.

DISCUSSION QUESTIONS (exactly 2 per category, short and direct, one sentence ideal, never compound/multi-part):
- Connecting: lighthearted conversation warm-ups that are thought-provoking but IMPERSONAL. Anyone can answer without feeling exposed. No personal memories or vulnerability here. (e.g., "What comes to mind when you hear the phrase 'salt and light'?")
- Considering: observation/interpretation questions about the Scripture text itself. Point people to the passage; ask what it says, warns, or commands. Do NOT reference the pastor or what they said. (e.g., "In Song of Songs 4:12-5:1, what does the imagery of a locked garden communicate about the relationship?")
- Confessing: invite honest personal reflection; where does the message hit home or expose a struggle. One honest question, not compound.
- Committing: push toward specific, actionable commitment ("who is one person...", "what is one step..."), never vague ("how can you be better?").

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
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 16384,
      temperature: 0.4,    },
  });
  const raw = res.text;
  if (!raw) throw new Error("Gemini returned an empty response");
  return parseGuide(raw);
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
  const stream = await ai.models.generateContentStream({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: guidePrompt(meta) }, audioPart] }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 16384,
      temperature: 0.4,    },
  });
  let text = "";
  for await (const chunk of stream) {
    if (chunk.text) text += chunk.text;
  }
  if (!text.trim()) throw new Error("Gemini returned an empty guide");
  return parseGuide(text);
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

// ---- Shared JSON parsing ----

function parseGuide(raw: string): GuideContent {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Gemini did not return valid JSON");
  }
  const obj = data as Record<string, unknown>;

  const asStringList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

  const dqRaw = (obj.discussion_questions ?? {}) as Record<string, unknown>;
  const discussion_questions: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(dqRaw)) {
    const list = asStringList(v);
    if (list.length) discussion_questions[k] = list;
  }

  return {
    recap: asStringList(obj.recap),
    one_thing: typeof obj.one_thing === "string" ? obj.one_thing.trim() : "",
    discussion_questions,
    next_steps: asStringList(obj.next_steps),
    next_steps_intro:
      typeof obj.next_steps_intro === "string" ? obj.next_steps_intro.trim() : undefined,
    next_steps_title:
      typeof obj.next_steps_title === "string" ? obj.next_steps_title.trim() : undefined,
  };
}
