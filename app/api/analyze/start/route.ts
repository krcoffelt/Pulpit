import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnalysisJobFromUpload, removeAnalysisJob } from "@/lib/analysis-jobs";
import { JOB_ID_PATTERN } from "@/lib/job-storage";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_PARTS, UPLOAD_PART_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  jobId: z.string().regex(JOB_ID_PATTERN),
  title: z.string().trim().max(180),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  totalChunks: z.number().int().positive().max(MAX_UPLOAD_PARTS),
});

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
    const input = requestSchema.parse(await request.json());
    const expectedChunks = Math.ceil(input.fileSize / UPLOAD_PART_BYTES);
    if (input.totalChunks !== expectedChunks) {
      return NextResponse.json({ error: "The uploaded file section count is invalid.", requestId }, { status: 400 });
    }

    console.info("[api/analyze/start] preparing media", { requestId, jobId: input.jobId, bytes: input.fileSize, chunks: input.totalChunks });
    const job = await createAnalysisJobFromUpload({
      ...input,
      title: input.title || friendlyTitle(input.fileName),
    });
    console.info("[api/analyze/start] ready", { requestId, jobId: job.jobId, duration: Math.round(job.duration), chunks: job.totalChunks });
    return NextResponse.json({ ...job, requestId }, { status: 201 });
  } catch (error) {
    const validationError = error instanceof z.ZodError;
    const message = validationError
      ? error.issues[0]?.message || "The upload details were invalid."
      : error instanceof Error ? error.message : "The sermon could not be prepared.";
    console.error("[api/analyze/start] failed", { requestId, message, error });
    return NextResponse.json({ error: `Preparing media failed: ${message}`, requestId }, { status: validationError ? 400 : 500 });
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
