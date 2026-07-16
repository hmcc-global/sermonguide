import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fetchPassage } from "@/lib/esv";

// Build-time guide loader. Faithful port of build.py's load/sort/neighbor logic,
// reading content/*.yaml from the repo root (one level up from the studio app).

const CONTENT_DIR = path.join(process.cwd(), "..", "content");
const FOOTER_BRAND = "HMCC";

export type GuideRef = { slug: string; series: string; part?: string };

export type Guide = {
  slug: string;
  series: string;
  part?: string;
  date?: string;
  order?: number;
  preacher?: string;
  scripture_title?: string;
  scripture_ref?: string;
  scripture_passage?: string[];
  recap?: string[];
  one_thing?: string;
  discussion_questions?: Record<string, string[]>;
  next_steps?: string[];
  next_steps_intro?: string;
  next_steps_title?: string;
  legacy_layout: boolean;
  footer_brand: string;
  newer: GuideRef | null;
  older: GuideRef | null;
};

let cached: Promise<Guide[]> | null = null;

export function loadAllGuides(): Promise<Guide[]> {
  if (!cached) cached = load();
  return cached;
}

export async function getGuide(slug: string): Promise<Guide | undefined> {
  const guides = await loadAllGuides();
  return guides.find((g) => g.slug === slug);
}

// For generateStaticParams: the dynamic segment is the literal "<slug>.html",
// which preserves the original URLs (e.g. /adore-2.html).
export async function listGuideParams(): Promise<{ guide: string }[]> {
  const guides = await loadAllGuides();
  return guides.map((g) => ({ guide: `${g.slug}.html` }));
}

async function load(): Promise<Guide[]> {
  let files: string[];
  try {
    files = fs
      .readdirSync(CONTENT_DIR)
      .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.startsWith("_"))
      .sort();
  } catch (e) {
    throw new Error(
      `Could not read guides from ${CONTENT_DIR}. On Vercel, set Root Directory to "studio" AND ` +
        `enable "Include files outside of the Root Directory in the Build Step". ` +
        `(${e instanceof Error ? e.message : String(e)})`,
    );
  }

  const guides: Guide[] = files.map((f) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, f), "utf-8");
    // JSON_SCHEMA keeps ISO dates as strings (the default schema would parse them
    // to Date objects), matching how build.py stringifies dates for display/sort.
    const data = (yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) || {};

    const g = data as unknown as Guide;
    g.slug = f.replace(/\.ya?ml$/, "");
    g.footer_brand = (data.footer_brand as string) ?? FOOTER_BRAND;
    // Respect an explicit legacy_layout, else derive from the presence of date
    // (build.py uses setdefault, which honors an explicit value).
    g.legacy_layout =
      "legacy_layout" in data ? Boolean(data.legacy_layout) : !("date" in data);
    if (data.date != null) g.date = String(data.date);
    return g;
  });

  // Scripture: match build.py — when a reference exists, fetch from ESV and let
  // it override any inline text; fall back to the inline YAML text on failure
  // (no key, cache miss, or network error). Concurrency-limited so a build with
  // a key doesn't fire dozens of requests at once. With no ESV_API_KEY (e.g.
  // local dev), every fetch returns null and the inline text is used unchanged.
  await mapLimit(guides, 8, async (g) => {
    const reference = g.scripture_ref || g.scripture_title;
    if (!reference) return;
    const fetched = await fetchPassage(reference);
    if (fetched) {
      g.scripture_passage = fetched;
    } else if (!g.scripture_passage || g.scripture_passage.length === 0) {
      console.warn(
        `[guides] "${g.slug}": scripture reference "${reference}" could not be resolved ` +
          `(no inline text, no cache, no ESV_API_KEY) — the passage section will be omitted.`,
      );
    }
  });

  // Ordering: `order` is only a same-date tie-breaker; newest date first. Two
  // stable sorts compose the rules (tie-breaker first, per build.py). Codepoint
  // comparison matches Python's str comparison exactly for ISO dates.
  guides.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  guides.sort((a, b) => {
    const da = String(a.date ?? "");
    const db = String(b.date ?? "");
    return db < da ? -1 : db > da ? 1 : 0;
  });

  guides.forEach((g, i) => {
    g.newer = i > 0 ? refOf(guides[i - 1]) : null;
    g.older = i < guides.length - 1 ? refOf(guides[i + 1]) : null;
  });

  return guides;
}

function refOf(g: Guide): GuideRef {
  return { slug: g.slug, series: g.series, part: g.part };
}

// Run an async task over items with a bounded number in flight; order of the
// items array is untouched (each task mutates its own element).
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// "2025-12-28" -> "Dec 28, 2025" (matches build.py's "%b %-d, %Y"; accepts
// non-zero-padded month/day like strptime; passes non-dates through unchanged).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function humandate(value?: string): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (!m) return String(value);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return String(value);
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}

// "^26" verse markers -> <sup class="verse">26</sup>, after HTML-escaping the
// surrounding text with the same entities markupsafe.escape emits.
export function versesHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
  return escaped.replace(/\^(\d+)/g, '<sup class="verse">$1</sup>');
}
