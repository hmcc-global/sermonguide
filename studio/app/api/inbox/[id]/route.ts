import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { commitChanges, makeOctokit } from "@/lib/github";
import { existingInboxPaths, getInboxItem, isValidInboxId } from "@/lib/inbox";

export const runtime = "nodejs";

// GET /api/inbox/<id> — full transcript + metadata, loaded when a leader picks an item.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = params;
  if (!isValidInboxId(id)) {
    return NextResponse.json({ error: "Invalid transcript id" }, { status: 400 });
  }
  try {
    const target = makeOctokit();
    const item = await getInboxItem(target, id);
    if (!item) {
      return NextResponse.json({ error: "Transcript not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not read the transcript";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/inbox/<id> — dismiss an item without publishing (removes the pair).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = params;
  if (!isValidInboxId(id)) {
    return NextResponse.json({ error: "Invalid transcript id" }, { status: 400 });
  }
  try {
    const target = makeOctokit();
    const deletes = await existingInboxPaths(target, id);
    if (deletes.length === 0) {
      return NextResponse.json({ ok: true }); // already gone — nothing to do
    }
    await commitChanges(target, `inbox: dismiss '${id}'`, { deletes });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not dismiss the transcript";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
