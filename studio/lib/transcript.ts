// Caption files -> plain prose.
//
// A sermon transcript arrives as WebVTT or SRT about as often as it arrives as
// plain text: SermonClipper delivers .vtt, and most transcription services
// export one of the two. Feeding those through raw means Gemini reads several
// thousand timestamps, cue numbers and <v> tags before it reaches a sentence,
// and the editor sees the same noise in the transcript box.
//
// Everything here is format detection by content rather than by file extension,
// because a .txt that happens to hold SRT is common and an extension is only a
// hint.

export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

export const TRANSCRIPT_ACCEPT = ".vtt,.srt,.txt,text/vtt,text/plain,application/x-subrip";

// Paragraphs are reflowed to roughly this width. Captions carry no paragraph
// structure at all, so this is purely for legibility in the textarea — it never
// invents a break mid-sentence.
const TARGET_PARAGRAPH_CHARS = 700;

const TIMESTAMP_LINE = /-->/;
const CUE_ID_LINE = /^\d+$/;
const BLOCK_KEYWORD = /^(NOTE|STYLE|REGION)\b/;

/** True if the text looks like WebVTT or SRT rather than prose. */
export function looksLikeCaptions(raw: string): boolean {
  const head = raw.slice(0, 4000);
  return /^﻿?WEBVTT/.test(head.trimStart()) || TIMESTAMP_LINE.test(head);
}

/**
 * Turn a transcript file's contents into clean prose.
 *
 * Plain text passes through with only whitespace normalization — it may already
 * be paragraphed by a human, and reflowing it would destroy that.
 */
export function parseTranscript(raw: string): string {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!looksLikeCaptions(text)) return normalizePlainText(text);
  return reflow(dedupeConsecutive(cueLines(text)));
}

function normalizePlainText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pull just the spoken text out of the cues, in order. */
function cueLines(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let skippingBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // NOTE / STYLE / REGION run until a blank line.
    if (skippingBlock) {
      if (!line) skippingBlock = false;
      continue;
    }
    if (BLOCK_KEYWORD.test(line)) {
      skippingBlock = true;
      continue;
    }

    if (!line) continue;
    if (/^WEBVTT/.test(line)) continue; // header, with or without trailing metadata
    if (TIMESTAMP_LINE.test(line)) continue; // "00:00:01.000 --> 00:00:04.000 align:start"

    // A bare number is a cue identifier only when a timestamp follows it.
    // In prose, a lone "1993" is content and must survive.
    if (CUE_ID_LINE.test(line) && TIMESTAMP_LINE.test(nextNonEmpty(lines, i))) continue;

    const cleaned = stripMarkup(line);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function nextNonEmpty(lines: string[], from: number): string {
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i].trim()) return lines[i].trim();
  }
  return "";
}

/** Drop cue tags (<v Speaker>, <i>, <00:00:01.000>, <c.loud>) and unescape. */
function stripMarkup(line: string): string {
  return decodeEntities(line.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; survives as &lt;
}

/**
 * Rolling captions repeat the previous line as new words scroll in, so the same
 * sentence can appear many times over. Collapsing runs of identical lines is
 * safe; a genuine repeated line in speech is rare and losing one is harmless
 * next to the noise this removes.
 */
function dedupeConsecutive(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out;
}

/**
 * Cue text breaks mid-sentence, so join it all back into continuous prose and
 * then split on sentence boundaries into readable paragraphs. Never breaks
 * anywhere except after sentence-ending punctuation.
 */
function reflow(lines: string[]): string {
  const prose = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!prose) return "";

  const sentences = prose.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [prose];
  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length >= TARGET_PARAGRAPH_CHARS) {
      paragraphs.push(next);
      current = "";
    } else {
      current = next;
    }
  }
  if (current) paragraphs.push(current);

  return paragraphs.join("\n\n");
}

/** Word count, for telling the editor what was loaded. */
export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}
