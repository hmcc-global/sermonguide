import { NextResponse, type NextRequest } from "next/server";
import { checkAdminPasscode } from "@/lib/auth";
import { getFileRaw, makeOctokit } from "@/lib/github";
import { isValidSlug, parseGuideForForm } from "@/lib/guide";

export const runtime = "nodejs";

// Admin-only: return one guide's fields, parsed for the edit form.
export async function GET(req: NextRequest) {
  if (!checkAdminPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const slug = req.nextUrl.searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }
  try {
    const raw = await getFileRaw(makeOctokit(), `content/${slug}.yaml`);
    if (raw == null) {
      return NextResponse.json({ error: `Guide "${slug}" not found` }, { status: 404 });
    }
    return NextResponse.json({ slug, ...parseGuideForForm(raw) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not load guide";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
