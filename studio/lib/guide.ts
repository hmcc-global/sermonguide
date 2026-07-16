import yaml from "js-yaml";

// ---- Types ----

export type GuideMeta = {
  series: string;
  part?: string;
  date?: string; // ISO YYYY-MM-DD; defaulted to today if absent
  preacher?: string;
  scripture_title?: string;
  scripture_ref?: string;
};

export type GuideContent = {
  recap: string[];
  one_thing?: string;
  discussion_questions: Record<string, string[]>;
  next_steps: string[];
  next_steps_intro?: string;
  next_steps_title?: string;
};

// ---- Slug (byte-for-byte match of scripts/guide_from_markdown.py) ----
// slug = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "guide"

export function slugify(text: string): string {
  const slug = text
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .toLowerCase();
  return slug || "guide";
}

export function makeSlug(series: string, part?: string): string {
  const base = `${series} ${part ?? ""}`.trim();
  return slugify(base);
}

// Guards a slug that arrives from a request (admin edit/delete, inbox id) against
// path traversal before it's interpolated into a repo path. slugify() only ever
// emits [a-z0-9-], so a legitimate slug always passes.
export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length > 0 && slug.length <= 200 && /^[a-z0-9-]+$/.test(slug);
}

// ---- Date: always emit ISO so build.py uses the modern layout ----

export function normalizeDate(input?: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return todayIso();
  // <input type="date"> already yields YYYY-MM-DD; accept a few extra forms defensively.
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(raw)) return raw;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return todayIso();
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---- Discussion question ordering (canonical HMCC order; unknowns appended in place) ----

const CATEGORY_ORDER = ["connecting", "considering", "confessing", "committing"];

export function orderQuestions(dq: Record<string, string[]>): Record<string, string[]> {
  const entries = Object.entries(dq).filter(([, v]) => Array.isArray(v) && v.length > 0);
  const rank = (name: string) => {
    const i = CATEGORY_ORDER.indexOf(name.toLowerCase());
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  // Array.prototype.sort is stable in Node 20, so unknown categories keep their original order.
  entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  return Object.fromEntries(entries);
}

// ---- YAML assembly. No scripture_passage: CI resolves it from scripture_ref via ESV. ----

export function buildGuideYaml(meta: GuideMeta, content: GuideContent): string {
  const obj: Record<string, unknown> = {};
  obj.series = meta.series;
  if (meta.part) obj.part = meta.part;
  obj.date = normalizeDate(meta.date);
  if (meta.preacher) obj.preacher = meta.preacher;
  if (meta.scripture_title) obj.scripture_title = meta.scripture_title;
  if (meta.scripture_ref) obj.scripture_ref = meta.scripture_ref;
  if (content.recap?.length) obj.recap = content.recap;
  if (content.one_thing) obj.one_thing = content.one_thing;
  const dq = orderQuestions(content.discussion_questions || {});
  if (Object.keys(dq).length) obj.discussion_questions = dq;
  if (content.next_steps_intro) obj.next_steps_intro = content.next_steps_intro;
  if (content.next_steps_title) obj.next_steps_title = content.next_steps_title;
  if (content.next_steps?.length) obj.next_steps = content.next_steps;

  // lineWidth: -1 keeps long paragraph strings on one line (no wrapping); insertion order preserved.
  return yaml.dump(obj, { lineWidth: -1, noRefs: true });
}

// ---- Manage view: parse an existing guide into form fields, and merge edits back ----

export type GuideFormData = {
  meta: { series: string; part: string; date: string; preacher: string; scripture: string };
  content: {
    recap: string[];
    one_thing: string;
    discussion_questions: Record<string, string[]>;
    next_steps: string[];
    next_steps_intro: string;
    next_steps_title: string;
  };
};

export function parseGuideForForm(raw: string): GuideFormData {
  const d = (yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) || {};
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const dq: Record<string, string[]> = {};
  for (const [k, v] of Object.entries((d.discussion_questions ?? {}) as Record<string, unknown>)) {
    dq[k] = list(v);
  }
  return {
    meta: {
      series: str(d.series),
      part: str(d.part),
      date: d.date != null ? String(d.date) : "",
      preacher: str(d.preacher),
      scripture: str(d.scripture_title) || str(d.scripture_ref),
    },
    content: {
      recap: list(d.recap),
      one_thing: str(d.one_thing),
      discussion_questions: dq,
      next_steps: list(d.next_steps),
      next_steps_intro: str(d.next_steps_intro),
      next_steps_title: str(d.next_steps_title),
    },
  };
}

// Overlay edited fields onto the ORIGINAL YAML so untouched keys (order,
// scripture_passage, footer_brand, ...) are preserved. Clearing a field removes
// its key. If the scripture reference changed, drop the stale inline passage.
export function mergeGuideYaml(originalRaw: string, meta: GuideMeta, content: GuideContent): string {
  const obj = (yaml.load(originalRaw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) || {};
  const origRef = String(obj.scripture_ref ?? obj.scripture_title ?? "");

  const set = (k: string, v: unknown) => {
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) delete obj[k];
    else obj[k] = v;
  };

  set("series", meta.series);
  set("part", meta.part);
  obj.date = normalizeDate(meta.date);
  set("preacher", meta.preacher);
  set("scripture_title", meta.scripture_title);
  set("scripture_ref", meta.scripture_ref);
  set("recap", content.recap);
  set("one_thing", content.one_thing);
  const dq = orderQuestions(content.discussion_questions || {});
  set("discussion_questions", Object.keys(dq).length ? dq : undefined);
  set("next_steps_intro", content.next_steps_intro);
  set("next_steps_title", content.next_steps_title);
  set("next_steps", content.next_steps);

  const newRef = String(meta.scripture_ref || meta.scripture_title || "");
  if (newRef !== origRef) delete obj.scripture_passage;

  return yaml.dump(obj, { lineWidth: -1, noRefs: true });
}

export function buildTranscriptMd(meta: GuideMeta, transcript: string): string {
  const title = [meta.series, meta.part].filter(Boolean).join(" — ");
  const lines = [
    `# ${title || meta.series} — transcript`,
    "",
    `- Date: ${normalizeDate(meta.date)}`,
  ];
  if (meta.preacher) lines.push(`- Preacher: ${meta.preacher}`);
  if (meta.scripture_title) lines.push(`- Scripture: ${meta.scripture_title}`);
  lines.push("", "---", "", transcript.trim(), "");
  return lines.join("\n");
}
