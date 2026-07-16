import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode } from "@/lib/auth";
import { listGuideSlugs, makeOctokit } from "@/lib/github";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const target = makeOctokit();
    const slugs = await listGuideSlugs(target);
    const base =
      process.env.SITE_URL?.replace(/\/+$/, "") ||
      `https://${target.owner}.github.io/${target.repo}`;
    return NextResponse.json({
      guides: slugs.map((slug) => ({ slug, url: `${base}/${slug}.html` })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not list guides";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
