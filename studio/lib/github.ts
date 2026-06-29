import { Octokit } from "@octokit/rest";

export type RepoTarget = {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
};

export type CommitFile = { path: string; content: string };

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
    await t.octokit.rest.repos.getContent({
      owner: t.owner,
      repo: t.repo,
      path,
      ref: t.branch,
    });
    return true;
  } catch (e: unknown) {
    if (isStatus(e, 404)) return false;
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
      .filter(
        (it) => it.type === "file" && /\.ya?ml$/.test(it.name) && !it.name.startsWith("_"),
      )
      .map((it) => it.name.replace(/\.ya?ml$/, ""))
      .sort();
  } catch {
    return [];
  }
}

// Atomic multi-file commit via the Git Data API. Retries on 409 (non-fast-forward).
export async function commitFiles(
  t: RepoTarget,
  message: string,
  files: CommitFile[],
): Promise<string> {
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

      const { data: tree } = await t.octokit.rest.git.createTree({
        owner: t.owner,
        repo: t.repo,
        base_tree: baseCommit.tree.sha,
        tree: files.map((f) => ({
          path: f.path,
          mode: "100644" as const,
          type: "blob" as const,
          content: f.content,
        })),
      });

      const { data: commit } = await t.octokit.rest.git.createCommit({
        owner: t.owner,
        repo: t.repo,
        message,
        tree: tree.sha,
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

function isStatus(e: unknown, status: number): boolean {
  return typeof e === "object" && e !== null && (e as { status?: number }).status === status;
}
