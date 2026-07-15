import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { findBestClips, getDuration, transcribeSermon, withTempUpload } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function friendlyTitle(filename: string) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  let stage = "configuration";

  if (!process.env.OPENAI_API_KEY) {
    console.error("[api/analyze] missing API key", { requestId });
    return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart the app.", requestId }, { status: 503 });
  }

  try {
    stage = "reading upload";
    const form = await request.formData();
    const file = form.get("file");
    const suppliedTitle = String(form.get("title") || "").trim().slice(0, 180);
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a video or audio file to analyze.", requestId }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "This local build accepts files up to 2 GB.", requestId }, { status: 413 });
    }

    console.info("[api/analyze] upload accepted", { requestId, bytes: file.size, type: file.type || "unknown" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 3 * 60 * 1000 });
    const result = await withTempUpload(file, "circumvision-analysis-", async ({ sourcePath }) => {
      stage = "probing media";
      const duration = await getDuration(sourcePath);
      console.info("[api/analyze] media ready", { requestId, duration: Math.round(duration) });
      stage = "transcribing audio";
      const transcript = await transcribeSermon(sourcePath, openai);
      console.info("[api/analyze] transcription complete", { requestId, segments: transcript.length });
      stage = "finding clips";
      const clips = await findBestClips(transcript, openai);
      return {
        title: suppliedTitle || friendlyTitle(file.name),
        duration,
        transcript,
        clips,
      };
    });
    console.info("[api/analyze] complete", { requestId, clips: result.clips.length });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sermon could not be analyzed.";
    console.error("[api/analyze] failed", { requestId, stage, message, error });
    return NextResponse.json({ error: `${stage[0].toUpperCase()}${stage.slice(1)} failed: ${message}`, requestId }, { status: 500 });
  }
}
