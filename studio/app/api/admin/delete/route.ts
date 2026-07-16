import { NextResponse, type NextRequest } from "next/server";
import { checkAdminPasscode } from "@/lib/auth";
import { commitChanges, fileExists, makeOctokit } from "@/lib/github";

export const runtime = "nodejs";

type DeleteBody = { slug?: string };

// Admin-only: delete a guide's YAML and its transcript archive in one commit.
export async function POST(req: NextRequest) {
  if (!checkAdminPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DeleteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

  let target;
  try {
    target = makeOctokit();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "GitHub is not configured";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const yamlPath = `content/${slug}.yaml`;
    if (!(await fileExists(target, yamlPath))) {
      return NextResponse.json({ error: `Guide "${slug}" not found` }, { status: 404 });
    }

    // Only delete paths that exist (deleting a missing path errors).
    const deletes = [yamlPath];
    const transcriptPath = `transcripts/${slug}.md`;
    if (await fileExists(target, transcriptPath)) deletes.push(transcriptPath);

    const commitSha = await commitChanges(target, `Delete guide '${slug}' via manage`, { deletes });
    return NextResponse.json({ slug, deleted: true, commitSha });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
