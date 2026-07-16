import { slugify } from "./guide";
import { fileExists, getFileRaw, type RepoTarget } from "./github";

// A staging area for transcripts delivered by SermonClipper (or anything else)
// before a leader turns them into a guide. Each item is a pair of files keyed by
// the same id, mirroring how content/<slug>.yaml and transcripts/<slug>.md pair up:
//   inbox/<id>.vtt   — the raw transcript
//   inbox/<id>.json  — sidecar metadata (title, date, source, …)
// Publishing a guide (or deleting) removes the pair; the transcript survives as
// transcripts/<slug>.md, so nothing is lost.

export const INBOX_DIR = "inbox";

export type InboxMeta = {
  title: string;
  date?: string; // ISO YYYY-MM-DD
  preacher?: string;
  source?: string; // e.g. "sermonClipper"
  sourceJobId?: string;
  receivedAt?: string; // ISO timestamp, set when the item lands
  words?: number;
};

export type InboxRow = InboxMeta & { id: string };
export type InboxItem = { id: string; meta: InboxMeta; vtt: string };

// id = "<date>-<slug(title)>", e.g. "2026-07-13-adore-part-5". Falls back to a
// title-only slug when no date is given. Always matches isValidInboxId().
export function makeInboxId(title: string, date?: string): string {
  const base = [date, title].filter((s) => s && s.trim()).join(" ");
  return slugify(base);
}

// Guards the id coming from a URL path segment against traversal / odd input.
// slugify() only ever emits [a-z0-9-] (never leading/trailing/doubled in a way
// that matters here), so a legitimate id always passes.
export function isValidInboxId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 200 && /^[a-z0-9-]+$/.test(id);
}

export function inboxPaths(id: string): [string, string] {
  return [`${INBOX_DIR}/${id}.vtt`, `${INBOX_DIR}/${id}.json`];
}

// Lists pending transcripts, newest first. Best-effort: returns [] if the inbox
// folder doesn't exist yet or a sidecar can't be parsed.
export async function listInbox(t: RepoTarget): Promise<InboxRow[]> {
  let entries: Array<{ type: string; name: string }>;
  try {
    const { data } = await t.octokit.rest.repos.getContent({
      owner: t.owner,
      repo: t.repo,
      path: INBOX_DIR,
      ref: t.branch,
    });
    if (!Array.isArray(data)) return [];
    entries = data;
  } catch {
    return []; // folder not created yet
  }

  const ids = entries
    .filter((it) => it.type === "file" && it.name.endsWith(".json"))
    .map((it) => it.name.replace(/\.json$/, ""));

  const rows = await Promise.all(
    ids.map(async (id): Promise<InboxRow> => {
      const raw = await getFileRaw(t, `${INBOX_DIR}/${id}.json`);
      let meta: InboxMeta = { title: id };
      if (raw) {
        try {
          meta = JSON.parse(raw) as InboxMeta;
        } catch {
          /* keep the fallback */
        }
      }
      return { id, ...meta, title: meta.title || id };
    }),
  );

  rows.sort((a, b) => {
    const ka = String(a.receivedAt ?? a.date ?? "");
    const kb = String(b.receivedAt ?? b.date ?? "");
    return kb < ka ? -1 : kb > ka ? 1 : 0; // newest first
  });
  return rows;
}

// Reads a single item (metadata + transcript text), or null if neither file exists.
export async function getInboxItem(t: RepoTarget, id: string): Promise<InboxItem | null> {
  const [metaPath, vttPath] = [`${INBOX_DIR}/${id}.json`, `${INBOX_DIR}/${id}.vtt`];
  const [metaRaw, vtt] = await Promise.all([getFileRaw(t, metaPath), getFileRaw(t, vttPath)]);
  if (metaRaw == null && vtt == null) return null;
  let meta: InboxMeta = { title: id };
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw) as InboxMeta;
    } catch {
      /* keep the fallback */
    }
  }
  return { id, meta, vtt: vtt ?? "" };
}

// Returns only the inbox paths that actually exist, so a commit that deletes them
// never fails on an already-removed file (e.g. a double publish).
export async function existingInboxPaths(t: RepoTarget, id: string): Promise<string[]> {
  const paths = inboxPaths(id);
  const present = await Promise.all(paths.map((p) => fileExists(t, p)));
  return paths.filter((_, i) => present[i]);
}
