import { NextResponse, type NextRequest } from "next/server";
import { checkPasscode } from "@/lib/auth";

export const runtime = "nodejs";

// Lightweight passcode check for the /create gate. The real enforcement is on
// each action route; this just lets the UI reveal the form only once the
// correct passcode is entered.
export async function GET(req: NextRequest) {
  return checkPasscode(req)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
