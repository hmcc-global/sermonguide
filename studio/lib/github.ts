import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";

export type RepoTarget = {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
};

export type CommitFile = { path: string; content: string };
export type GuideMetaRow = {
  slug: string;
  series?: string;
  part?: string;
  date?: string;
  preacher?: string;
};

export function makeOctokit(): { octokit: Octokit; owner: string; repo: string; branch: string } {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) throw new Error("GITHUB_OWNER / GITHUB_REPO are not set");
  const branch = process.env.GITHUB_BRANCH || "main";
  return { octokit: new Octokit({ auth: token }), owner, repo, branch };
}

export async function fileExists(t: RepoTarget, path: string): Promise<boolean> {
  try {
    await t.octokit.rest.repos.getContent({ owner: t.owner, repo: t.repo, path, ref: t.branch });
    return true;
  } catch (e: unknown) {
    if (isStatus(e, 404)) return false;
    throw e;
  }
}

// Fetch a file's UTF-8 text, or null if it doesn't exist.
export async function getFileRaw(t: RepoTarget, path: string): Promise<string | null> {
  try {
    const { data } = await t.octokit.rest.repos.getContent({
      owner: t.owner,
      repo: t.repo,
      path,
      ref: t.branch,
    });
    if (!Array.isArray(data) && "content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch (e: unknown) {
    if (isStatus(e, 404)) return null;
    throw e;
  }
}

// Lists published guide slugs (content/*.yaml, excluding `_`-prefixed). Best-effort.
export async function listGuideSlugs(t: RepoTarget): Promise<string[]> {
  try {
    const { data } = await t.octokit.rest.repos.getContent({
      owner: t.owner,
      repo: t.repo,
      path: "content",
      ref: t.branch,
    });
    if (!Array.isArray(data)) return [];
    return data
      .filter((it) => it.type === "file" && /\.ya?ml$/.test(it.name) && !it.name.startsWith("_"))
      .map((it) => it.name.replace(/\.ya?ml$/, ""))
      .sort();
  } catch {
    return [];
  }
}

// Guides with light metadata for the manage list (newest first).
export async function listGuidesWithMeta(t: RepoTarget): Promise<GuideMetaRow[]> {
  const slugs = await listGuideSlugs(t);
  const rows = await mapLimit(slugs, 8, async (slug): Promise<GuideMetaRow> => {
    const raw = await getFileRaw(t, `content/${slug}.yaml`);
    if (!raw) return { slug };
    const d = (yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) || {};
    return {
      slug,
      series: typeof d.series === "string" ? d.series : undefined,
      part: typeof d.part === "string" ? d.part : undefined,
      date: d.date != null ? String(d.date) : undefined,
      preacher: typeof d.preacher === "string" ? d.preacher : undefined,
    };
  });
  rows.sort((a, b) => {
    const da = String(a.date ?? "");
    const db = String(b.date ?? "");
    return db < da ? -1 : db > da ? 1 : 0;
  });
  return rows;
}

// Atomic commit: upsert files and/or delete paths in one commit. Retries on 409.
export async function commitChanges(
  t: RepoTarget,
  message: string,
  changes: { upserts?: CommitFile[]; deletes?: string[] },
): Promise<string> {
  const upserts = changes.upserts ?? [];
  const deletes = changes.deletes ?? [];
  if (upserts.length === 0 && deletes.length === 0) {
    throw new Error("commitChanges called with no changes");
  }

  type TreeItem = {
    path: string;
    mode: "100644";
    type: "blob";
    content?: string;
    sha?: string | null;
  };
  const tree: TreeItem[] = [
    ...upserts.map((f) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      content: f.content,
    })),
    // sha: null tells the Git Data API to delete the path.
    ...deletes.map((p) => ({ path: p, mode: "100644" as const, type: "blob" as const, sha: null })),
  ];

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data: ref } = await t.octokit.rest.git.getRef({
        owner: t.owner,
        repo: t.repo,
        ref: `heads/${t.branch}`,
      });
      const parentSha = ref.object.sha;

      const { data: baseCommit } = await t.octokit.rest.git.getCommit({
        owner: t.owner,
        repo: t.repo,
        commit_sha: parentSha,
      });

      const { data: newTree } = await t.octokit.rest.git.createTree({
        owner: t.owner,
        repo: t.repo,
        base_tree: baseCommit.tree.sha,
        tree,
      });

      const { data: commit } = await t.octokit.rest.git.createCommit({
        owner: t.owner,
        repo: t.repo,
        message,
        tree: newTree.sha,
        parents: [parentSha],
      });

      await t.octokit.rest.git.updateRef({
        owner: t.owner,
        repo: t.repo,
        ref: `heads/${t.branch}`,
        sha: commit.sha,
        force: false,
      });

      return commit.sha;
    } catch (e: unknown) {
      lastErr = e;
      if (isStatus(e, 409) && attempt < 2) continue; // someone else pushed; rebuild and retry
      throw e;
    }
  }
  throw lastErr;
}

// Backwards-compatible wrapper (upserts only) for the publish route.
export async function commitFiles(
  t: RepoTarget,
  message: string,
  files: CommitFile[],
): Promise<string> {
  return commitChanges(t, message, { upserts: files });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

function isStatus(e: unknown, status: number): boolean {
  return typeof e === "object" && e !== null && (e as { status?: number }).status === status;
}
