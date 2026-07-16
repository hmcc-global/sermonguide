import { NextResponse, type NextRequest } from "next/server";
import { del } from "@vercel/blob";
import { checkPasscode } from "@/lib/auth";
import { generateFromAudio, generateGuideFromTranscript } from "@/lib/gemini";
import type { GuideMeta } from "@/lib/guide";

export const runtime = "nodejs";
export const maxDuration = 300; // requires Fluid compute; audio + transcript can take 1-2 min

// SSRF guard: only ever fetch/del a Vercel Blob URL. Without this, a caller could point
// blobUrl at an internal address (e.g. cloud metadata) and have the server fetch it.
function isVercelBlobUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

type GenerateBody = {
  meta?: GuideMeta;
  transcript?: string; // Phase 1 path
  blobUrl?: string; // Phase 2 path (audio)
  mimeType?: string;
};

export async function POST(req: NextRequest) {
  if (!checkPasscode(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const meta = body.meta;
  if (!meta?.series?.trim()) {
    return NextResponse.json({ error: "Series is required" }, { status: 400 });
  }

  try {
    // --- Audio path ---
    if (body.blobUrl) {
      const blobUrl = body.blobUrl;
      if (!isVercelBlobUrl(blobUrl)) {
        return NextResponse.json({ error: "Invalid audio URL" }, { status: 400 });
      }
      try {
        const bytes = await fetchBlobBytes(blobUrl);
        const result = await generateFromAudio(bytes, body.mimeType || "audio/mp3", meta);
        return NextResponse.json(result);
      } finally {
        // Always delete the blob (Gemini has its own copy) — even on failure, to stay on free storage.
        try {
          await del(blobUrl);
        } catch {
          /* best effort */
        }
      }
    }

    // --- Transcript path ---
    const transcript = (body.transcript ?? "").trim();
    if (!transcript) {
      return NextResponse.json(
        { error: "Provide a transcript or an audio file" },
        { status: 400 },
      );
    }
    const guide = await generateGuideFromTranscript(transcript, meta);
    return NextResponse.json({ guide, transcript, transcriptFailed: false });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchBlobBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read the uploaded audio (${res.status})`);
  return res.arrayBuffer();
}
