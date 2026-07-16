import { NextResponse, type NextRequest } from "next/server";
import { checkAdminPasscode } from "@/lib/auth";
import { commitChanges, getFileRaw, makeOctokit, type CommitFile } from "@/lib/github";
import { makeSlug, mergeGuideYaml, type GuideContent, type GuideMeta } from "@/lib/guide";

export const runtime = "nodejs";

type FormMeta = {
  series: string;
  part?: string;
  date?: string;
  preacher?: string;
  scripture?: string;
};

type SaveBody = {
  originalSlug?: string;
  meta?: FormMeta;
  content?: GuideContent;
  confirmOverwrite?: boolean;
};

export async function POST(req: NextRequest) {
  if (!checkAdminPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const originalSlug = body.originalSlug?.trim();
  const form = body.meta;
  const content = body.content;
  if (!originalSlug) return NextResponse.json({ error: "originalSlug is required" }, { status: 400 });
  if (!form?.series?.trim()) return NextResponse.json({ error: "Series is required" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "Guide content is required" }, { status: 400 });

  const scripture = form.scripture?.trim() || undefined;
  const meta: GuideMeta = {
    series: form.series.trim(),
    part: form.part?.trim() || undefined,
    date: form.date || undefined,
    preacher: form.preacher?.trim() || undefined,
    scripture_title: scripture,
    scripture_ref: scripture,
  };
  const newSlug = makeSlug(meta.series, meta.part);

  let target;
  try {
    target = makeOctokit();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "GitHub is not configured";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const originalRaw = await getFileRaw(target, `content/${originalSlug}.yaml`);
    if (originalRaw == null) {
      return NextResponse.json(
        { error: `The guide "${originalSlug}" no longer exists.` },
        { status: 404 },
      );
    }

    const mergedYaml = mergeGuideYaml(originalRaw, meta, content);
    const upserts: CommitFile[] = [{ path: `content/${newSlug}.yaml`, content: mergedYaml }];
    const deletes: string[] = [];
    const renamed = newSlug !== originalSlug;

    if (renamed) {
      // Don't silently clobber a different existing guide at the new slug.
      if (!body.confirmOverwrite) {
        const clash = await getFileRaw(target, `content/${newSlug}.yaml`);
        if (clash != null) {
          return NextResponse.json(
            {
              needsConfirm: true,
              slug: newSlug,
              message: `A different guide named "${newSlug}" already exists.`,
            },
            { status: 409 },
          );
        }
      }
      // Move the transcript archive alongside the rename, if present.
      const oldTranscript = await getFileRaw(target, `transcripts/${originalSlug}.md`);
      if (oldTranscript != null) {
        upserts.push({ path: `transcripts/${newSlug}.md`, content: oldTranscript });
        deletes.push(`transcripts/${originalSlug}.md`);
      }
      deletes.push(`content/${originalSlug}.yaml`);
    }

    const message = renamed
      ? `Rename guide '${originalSlug}' -> '${newSlug}' via manage`
      : `Edit guide '${newSlug}' via manage`;
    const commitSha = await commitChanges(target, message, { upserts, deletes });

    const base =
      process.env.SITE_URL?.replace(/\/+$/, "") ||
      `https://${target.owner}.github.io/${target.repo}`;
    return NextResponse.json({
      slug: newSlug,
      renamed,
      commitSha,
      liveUrl: `${base}/${newSlug}.html`,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
