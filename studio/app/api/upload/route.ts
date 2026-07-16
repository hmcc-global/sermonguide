import { NextResponse, type NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { secretsMatch } from "@/lib/auth";

export const runtime = "nodejs";

// Mints a scoped, single-upload client token so the browser can send the mp3
// straight to Vercel Blob (bypassing the 4.5 MB function-body limit).
// The passcode is verified inside onBeforeGenerateToken — without that check
// this route would be open to the public.
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        if (!secretsMatch(clientPayload, process.env.APP_PASSCODE)) {
          throw new Error("Unauthorized");
        }
        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp3",
            "audio/mp4",
            "audio/x-m4a",
            "audio/m4a",
            "audio/wav",
            "audio/x-wav",
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 250 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // No-op: the browser drives the flow with the URL returned by upload().
        // (This webhook also doesn't fire on localhost without a tunnel.)
      },
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Upload authorization failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
