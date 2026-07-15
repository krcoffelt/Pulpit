import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { findBestClips } from "@/lib/clip-selection";
import { requireProject, saveProject } from "@/lib/projects";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  targetDuration: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
});

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI is not configured.", requestId }, { status: 503 });
    const user = await requireCircumvisionUser();
    await enforceRateLimit(user.id, "suggestion-regenerate", 20, 24 * 60 * 60 * 1000);
    const { projectId } = await context.params;
    const input = requestSchema.parse(await request.json().catch(() => ({})));
    const project = await requireProject(user.id, projectId);
    const transcript = project.editor?.transcript || project.analysis?.transcript;
    if (!transcript?.length) throw new Error("Finish the transcript before regenerating clip suggestions.");
    const targetDuration = input.targetDuration || project.targetDuration || 30;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 4 * 60 * 1000 });
    const clips = await findBestClips(transcript, openai, targetDuration);
    if (!clips.length) throw new Error("No complete, non-overlapping moments were found.");
    project.targetDuration = targetDuration;
    if (project.analysis) project.analysis.clips = clips;
    if (project.editor) {
      project.editor.clips = clips;
      project.editor.selectedClipId = clips[0]?.id;
    }
    await saveProject(project);
    console.info("[api/suggestions] regenerated", { requestId, projectId, targetDuration, clips: clips.length });
    return NextResponse.json({ clips, targetDuration, requestId });
  } catch (error) {
    return apiError(error, requestId, "Clip suggestions could not be regenerated.", error instanceof z.ZodError);
  }
}
