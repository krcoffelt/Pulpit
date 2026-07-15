import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAnalysisJob, removeAnalysisJob } from "@/lib/analysis-jobs";

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
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart the app.", requestId }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const suppliedTitle = String(form.get("title") || "").trim().slice(0, 180);
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a video or audio file to analyze.", requestId }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "This local build accepts files up to 2 GB.", requestId }, { status: 413 });
    }

    console.info("[api/analyze/start] preparing media", { requestId, bytes: file.size, type: file.type || "unknown" });
    const job = await createAnalysisJob(file, suppliedTitle || friendlyTitle(file.name));
    console.info("[api/analyze/start] ready", { requestId, jobId: job.jobId, duration: Math.round(job.duration), chunks: job.totalChunks });
    return NextResponse.json({ ...job, requestId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sermon could not be prepared.";
    console.error("[api/analyze/start] failed", { requestId, message, error });
    return NextResponse.json({ error: `Preparing media failed: ${message}`, requestId }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  try {
    await removeAnalysisJob(jobId);
    return NextResponse.json({ ok: true, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The analysis job could not be removed.";
    return NextResponse.json({ error: message, requestId }, { status: 400 });
  }
}
