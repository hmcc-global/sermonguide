import { NextResponse, type NextRequest } from "next/server";
import { checkAdminPasscode } from "@/lib/auth";

export const runtime = "nodejs";

// Verifies the admin passcode for the /manage gate.
export async function GET(req: NextRequest) {
  return checkAdminPasscode(req)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
