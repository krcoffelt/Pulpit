import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { transcribeAnalysisChunk } from "@/lib/analysis-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  jobId: z.string().regex(/^job-[a-zA-Z0-9_-]+$/),
  chunkIndex: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart the app.", requestId }, { status: 503 });
  }

  try {
    const input = requestSchema.parse(await request.json());
    console.info("[api/analyze/transcribe] started", { requestId, jobId: input.jobId, chunkIndex: input.chunkIndex });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 2 * 60 * 1000 });
    const progress = await transcribeAnalysisChunk(input.jobId, input.chunkIndex, openai);
    console.info("[api/analyze/transcribe] complete", { requestId, jobId: input.jobId, ...progress });
    return NextResponse.json({ ...progress, requestId });
  } catch (error) {
    const validationError = error instanceof z.ZodError;
    const message = validationError
      ? error.issues[0]?.message || "The transcription request was invalid."
      : error instanceof Error ? error.message : "This audio section could not be transcribed.";
    console.error("[api/analyze/transcribe] failed", { requestId, message, error });
    return NextResponse.json({ error: `Transcription failed: ${message}`, requestId }, { status: validationError ? 400 : 500 });
  }
}
