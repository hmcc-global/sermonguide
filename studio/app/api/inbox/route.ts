import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { commitFiles, makeOctokit } from "@/lib/github";
import { INBOX_DIR, listInbox, makeInboxId, type InboxMeta } from "@/lib/inbox";

export const runtime = "nodejs";

// A sermon VTT is tens–hundreds of KB; cap well above that but far below the repo-bloat
// range so a crafted/looping caller can't commit huge blobs. Vercel also bounds the body.
const MAX_VTT_BYTES = 5 * 1024 * 1024;

// GET /api/inbox — list pending transcripts for the /create picker.
export async function GET(req: NextRequest) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const target = makeOctokit();
    const items = await listInbox(target);
    return NextResponse.json({ items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not list the transcript inbox";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PostBody = {
  vtt?: string;
  title?: string;
  date?: string;
  preacher?: string;
  source?: string;
  sourceJobId?: string;
  words?: number;
};

// POST /api/inbox — SermonClipper drops a finished transcript here. Same passcode
// gate as the rest of the studio (x-app-passcode). Commits the .vtt + .json pair.
export async function POST(req: NextRequest) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const vtt = (body.vtt ?? "").trim();
  if (!vtt) {
    return NextResponse.json({ error: "vtt is required" }, { status: 400 });
  }
  if (Buffer.byteLength(vtt, "utf8") > MAX_VTT_BYTES) {
    return NextResponse.json({ error: "Transcript is too large" }, { status: 413 });
  }
  const title = (body.title ?? "").trim() || "Untitled sermon";
  const date = (body.date ?? "").trim() || undefined;
  const sourceJobId = (body.sourceJobId ?? "").trim() || undefined;
  const id = makeInboxId(title, date, sourceJobId);

  const meta: InboxMeta = {
    title,
    date,
    preacher: (body.preacher ?? "").trim() || undefined,
    source: (body.source ?? "").trim() || undefined,
    sourceJobId,
    receivedAt: new Date().toISOString(),
    words:
      typeof body.words === "number" && body.words > 0
        ? body.words
        : vtt.split(/\s+/).filter(Boolean).length,
  };

  try {
    const target = makeOctokit();
    await commitFiles(target, `inbox: add transcript '${id}'`, [
      { path: `${INBOX_DIR}/${id}.vtt`, content: vtt.endsWith("\n") ? vtt : `${vtt}\n` },
      { path: `${INBOX_DIR}/${id}.json`, content: `${JSON.stringify(meta, null, 2)}\n` },
    ]);
    return NextResponse.json({ id, meta });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not save the transcript";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
