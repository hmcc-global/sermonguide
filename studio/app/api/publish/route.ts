import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode } from "@/lib/auth";
import {
  buildGuideYaml,
  buildTranscriptMd,
  makeSlug,
  type GuideContent,
  type GuideMeta,
} from "@/lib/guide";
import { commitFiles, fileExists, makeOctokit, type CommitFile } from "@/lib/github";

export const runtime = "nodejs";

type PublishBody = {
  meta?: GuideMeta;
  content?: GuideContent;
  transcript?: string;
  confirmOverwrite?: boolean;
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

  const { meta, content, transcript, confirmOverwrite } = body;
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

    const commitSha = await commitFiles(target, `Add guide '${slug}' via studio`, files);
    const liveUrl = `https://${target.owner}.github.io/${target.repo}/${slug}.html`;

    return NextResponse.json({ slug, commitSha, liveUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
