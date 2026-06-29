import type { NextRequest } from "next/server";

// Shared-passcode gate. Fails closed if APP_PASSCODE is unset.
// Every API route must call this before doing any work.
export function checkPasscode(req: NextRequest): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;
  const given = req.headers.get("x-app-passcode");
  return typeof given === "string" && given.length > 0 && given === expected;
}
