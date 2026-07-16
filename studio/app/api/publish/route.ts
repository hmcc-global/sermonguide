import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode } from "@/lib/auth";
import {
  buildGuideYaml,
  buildTranscriptMd,
  makeSlug,
  type GuideContent,
  type GuideMeta,
} from "@/lib/guide";
import { commitChanges, fileExists, makeOctokit, type CommitFile } from "@/lib/github";
import { existingInboxPaths, isValidInboxId } from "@/lib/inbox";

export const runtime = "nodejs";

type PublishBody = {
  meta?: GuideMeta;
  content?: GuideContent;
  transcript?: string;
  confirmOverwrite?: boolean;
  inboxId?: string; // when the guide came from an inbox item, clear it in the same commit
};

export async function POST(req: NextRequest) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PublishBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { meta, content, transcript, confirmOverwrite, inboxId } = body;
  if (!meta?.series?.trim()) {
    return NextResponse.json({ error: "Series is required" }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "Guide content is required" }, { status: 400 });
  }

  const slug = makeSlug(meta.series, meta.part);
  const yamlPath = `content/${slug}.yaml`;
  const transcriptPath = `transcripts/${slug}.md`;

  let target;
  try {
    target = makeOctokit();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "GitHub is not configured";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    if (!confirmOverwrite && (await fileExists(target, yamlPath))) {
      return NextResponse.json(
        { needsConfirm: true, slug, message: `A guide named "${slug}" already exists.` },
        { status: 409 },
      );
    }

    const files: CommitFile[] = [{ path: yamlPath, content: buildGuideYaml(meta, content) }];
    if (transcript && transcript.trim()) {
      files.push({ path: transcriptPath, content: buildTranscriptMd(meta, transcript) });
    }

    // If this guide came from an inbox item, remove that staging pair in the same
    // commit. The transcript is preserved as transcripts/<slug>.md above.
    const deletes =
      inboxId && isValidInboxId(inboxId) ? await existingInboxPaths(target, inboxId) : [];

    const commitSha = await commitChanges(target, `Add guide '${slug}' via studio`, {
      upserts: files,
      deletes,
    });
    const base =
      process.env.SITE_URL?.replace(/\/+$/, "") ||
      `https://${target.owner}.github.io/${target.repo}`;
    const liveUrl = `${base}/${slug}.html`;

    return NextResponse.json({ slug, commitSha, liveUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Publish failed";
    const status = (e as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json(
        {
          error: `GitHub returned 404 for ${target.owner}/${target.repo}@${target.branch}. Check that GITHUB_OWNER (${target.owner}), GITHUB_REPO (${target.repo}), and GITHUB_BRANCH (${target.branch}) are exactly right with no typos or trailing spaces, that "${target.branch}" is a real branch, and that GITHUB_TOKEN has Contents: write access to this repo. Redeploy after any env change.`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
