import type { GuideMeta, GuideContent } from "@/lib/guide";

// Groq exposes an OpenAI-compatible API. Models are overridable without a code change.
const API = "https://api.groq.com/openai/v1";
const CHAT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";

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

function apiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return key;
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

async function groqError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const j = await res.json();
    detail = j?.error?.message || "";
  } catch {
    /* ignore */
  }
  return new Error(`Groq API error (${res.status})${detail ? `: ${detail}` : ""}`);
}

// ---- Transcript -> guide ----

export async function generateGuideFromTranscript(
  transcript: string,
  meta: GuideMeta,
): Promise<GuideContent> {
  const key = apiKey();
  const prompt = `${guidePrompt(meta)}\n\n--- TRANSCRIPT ---\n${transcript}`;
  return withRetry(async () => {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) throw await groqError(res);
    const data = await res.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw?.trim()) throw new Error("Groq returned an empty response");
    return parseGuide(raw);
  });
}

// ---- Audio -> { guide, transcript } (Whisper transcription, then the guide) ----

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
  const transcript = await transcribe(audioBytes, mimeType);
  const guide = await generateGuideFromTranscript(transcript, meta);
  return { guide, transcript, transcriptFailed: false };
}

async function transcribe(bytes: ArrayBuffer, mimeType: string): Promise<string> {
  const key = apiKey();
  return withRetry(async () => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), "sermon" + extFor(mimeType));
    form.append("model", STT_MODEL);
    form.append("response_format", "text");
    form.append("temperature", "0");
    const res = await fetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw await groqError(res);
    const text = (await res.text()).trim();
    if (!text) throw new Error("Empty transcript");
    return text;
  });
}

function extFor(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return ".m4a";
  if (m.includes("wav")) return ".wav";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("webm")) return ".webm";
  if (m.includes("flac")) return ".flac";
  return ".mp3";
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
  if (!obj) throw new Error("Groq did not return valid JSON");

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
    throw new Error("Groq did not return valid JSON");
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
