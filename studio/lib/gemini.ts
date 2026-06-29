import { GoogleGenAI, FileState, createPartFromUri, type Part } from "@google/genai";
import type { GuideMeta, GuideContent } from "@/lib/guide";

const MODEL = "gemini-2.5-flash";

const INSTRUCTIONS = `You turn a church sermon into a structured small-group study guide for HMCC (Harvest Mission Community Church).

Return ONLY a JSON object with exactly these fields:
{
  "recap": string[],            // 2-4 short paragraphs summarizing the sermon's message
  "one_thing": string,          // a single sentence: the one main takeaway
  "discussion_questions": {     // HMCC's four categories, 1-3 questions each
    "Connecting": string[],     // warm-up / relational questions to open the group
    "Considering": string[],    // observation / understanding of the text and message
    "Confessing": string[],     // self-examination / honest reflection
    "Committing": string[]      // application / next-step commitment
  },
  "next_steps": string[]        // 2-4 concrete, practical action items for the week
}

Rules:
- Base everything strictly on the sermon content provided. Do not invent quotes, scripture, statistics, or stories.
- Do not include any scripture passage text or references in the output (those are handled separately).
- Keep language warm, clear, and accessible to a small group.
- Output valid JSON only. No markdown, no commentary, no code fences.`;

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
      maxOutputTokens: 8192,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 },
    },
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
      maxOutputTokens: 8192,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 },
    },
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
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
    },
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
