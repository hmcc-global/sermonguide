import fs from "node:fs";
import path from "node:path";

// Build-time ESV passage fetch, ported from build.py. Reads a disk cache first,
// fetches from the ESV API when ESV_API_KEY is set, and returns null so the
// caller can fall back to the text already in the YAML.

const ESV_TEXT_URL = "https://api.esv.org/v3/passage/text/";
const ESV_PARAMS: Record<string, string> = {
  "include-passage-references": "false",
  "include-verse-numbers": "true",
  "include-first-verse-numbers": "true",
  "include-footnotes": "false",
  "include-headings": "false",
  "include-short-copyright": "false",
  "include-passage-horizontal-lines": "false",
  "include-heading-horizontal-lines": "false",
  "indent-poetry": "false",
  "line-length": "0",
};

const CACHE_DIR = path.join(process.cwd(), "..", "content", ".cache");

function cachePath(reference: string): string {
  const safe = reference
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();
  return path.join(CACHE_DIR, `${safe}.json`);
}

// Split ESV plain text into paragraphs and convert its "[26]" markers to "^26".
function parseEsv(passage: string): string[] {
  const out: string[] = [];
  for (const chunk of passage.trim().split(/\n\s*\n/)) {
    const text = chunk
      .trim()
      .replace(/\s*\n\s*/g, " ")
      .replace(/\[(\d+)\]\s*/g, "^$1 ")
      .trim();
    if (text) out.push(text);
  }
  return out;
}

export async function fetchPassage(reference: string): Promise<string[] | null> {
  const file = cachePath(reference);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Array.isArray(cached.passages)) return cached.passages as string[];
  } catch {
    /* cache miss or corrupt — fetch below */
  }

  const key = (process.env.ESV_API_KEY || "").trim();
  if (!key) return null;

  const query = new URLSearchParams({ ...ESV_PARAMS, q: reference }).toString();
  let payload: { passages?: string[]; canonical?: string };
  try {
    const res = await fetch(`${ESV_TEXT_URL}?${query}`, {
      headers: { Authorization: `Token ${key}` },
    });
    if (!res.ok) return null;
    payload = (await res.json()) as { passages?: string[]; canonical?: string };
  } catch {
    return null;
  }

  const passages = parseEsv((payload.passages ?? []).join("\n\n"));
  if (!passages.length) return null;

  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ reference: payload.canonical ?? reference, passages }, null, 2),
    );
  } catch {
    /* best effort; the cache is an optimization only */
  }
  return passages;
}
