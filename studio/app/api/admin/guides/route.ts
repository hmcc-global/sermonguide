import { NextResponse, type NextRequest } from "next/server";
import { checkAdminPasscode } from "@/lib/auth";
import { listGuidesWithMeta, makeOctokit } from "@/lib/github";

export const runtime = "nodejs";

// Admin-only: list all published guides with light metadata for the manage view.
export async function GET(req: NextRequest) {
  if (!checkAdminPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await listGuidesWithMeta(makeOctokit());
    return NextResponse.json({ guides: rows });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not list guides";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
