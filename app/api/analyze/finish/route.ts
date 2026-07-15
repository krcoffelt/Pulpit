import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { finishAnalysisJob } from "@/lib/analysis-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  jobId: z.string().regex(/^job-[a-zA-Z0-9_-]+$/),
});

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart the app.", requestId }, { status: 503 });
  }

  try {
    const input = requestSchema.parse(await request.json());
    console.info("[api/analyze/finish] finding clips", { requestId, jobId: input.jobId });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 2 * 60 * 1000 });
    const result = await finishAnalysisJob(input.jobId, openai);
    console.info("[api/analyze/finish] complete", { requestId, clips: result.clips.length });
    return NextResponse.json({ ...result, requestId });
  } catch (error) {
    const validationError = error instanceof z.ZodError;
    const message = validationError
      ? error.issues[0]?.message || "The analysis request was invalid."
      : error instanceof Error ? error.message : "The strongest moments could not be selected.";
    console.error("[api/analyze/finish] failed", { requestId, message, error });
    return NextResponse.json({ error: `Finding clips failed: ${message}`, requestId }, { status: validationError ? 400 : 500 });
  }
}
