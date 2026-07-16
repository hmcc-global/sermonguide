import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// Constant-time secret comparison. Hashing both sides to a fixed 32-byte digest
// means timingSafeEqual always gets equal-length buffers and the secret's length
// isn't leaked. Fails closed when `expected` is unset or `given` is missing/empty.
export function secretsMatch(given: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || typeof given !== "string" || given.length === 0) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Shared-passcode gate. Fails closed if APP_PASSCODE is unset.
// Every API route must call this before doing any work.
export function checkPasscode(req: NextRequest): boolean {
  return secretsMatch(req.headers.get("x-app-passcode"), process.env.APP_PASSCODE);
}

// Separate, higher-privilege gate for the /manage view (edit + delete).
// Distinct passcode and header from the create audience. Fails closed.
export function checkAdminPasscode(req: NextRequest): boolean {
  return secretsMatch(req.headers.get("x-admin-passcode"), process.env.ADMIN_PASSCODE);
}
