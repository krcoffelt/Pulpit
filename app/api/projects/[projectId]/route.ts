import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { deleteProject, requireProject, saveProject } from "@/lib/projects";
import type { CircumvisionProject } from "@/lib/types";
import { PublicError } from "@/lib/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  editor: z.object({
    clips: z.array(z.object({
      id: z.string().min(1).max(100),
      title: z.string().trim().min(1).max(180),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      hook: z.string().max(500),
      score: z.number().min(0).max(100),
      reason: z.string().max(1000),
    platform: z.string().max(100),
      scores: z.object({
        hookStrength: z.number().min(0).max(100),
        emotionalImpact: z.number().min(0).max(100),
        clarity: z.number().min(0).max(100),
        completeness: z.number().min(0).max(100),
        faithfulness: z.number().min(0).max(100),
        shareability: z.number().min(0).max(100),
      }).optional(),
    })).max(30),
    transcript: z.array(z.object({
      id: z.string().min(1).max(100),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      text: z.string().max(2000),
      speaker: z.string().max(100),
    })).max(20_000),
    settings: z.object({
      aspect: z.enum(["9:16", "4:5", "1:1"]),
      captionPreset: z.enum(["bold", "clean", "minimal"]),
      captionPosition: z.enum(["middle", "bottom"]),
      captionScale: z.number().min(0.5).max(2),
      captionsEnabled: z.boolean(),
      highlight: z.boolean(),
      frameMode: z.enum(["fill", "fit"]),
      frameX: z.number().min(-100).max(100).default(0),
      frameY: z.number().min(-100).max(100).default(0),
    }),
    selectedClipId: z.string().max(100).optional(),
  }).optional(),
});

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const user = await requireCircumvisionUser();
    const { projectId } = await context.params;
    const project = await requireProject(user.id, projectId);
    return NextResponse.json({ project, requestId });
  } catch (error) {
    return apiError(error, requestId, "The project could not be loaded.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    const { projectId } = await context.params;
    const input = patchSchema.parse(await request.json());
    const project = await requireProject(user.id, projectId);
    if (input.title) project.title = input.title;
    if (input.editor) {
      for (const clip of input.editor.clips) {
        if (clip.end <= clip.start || project.duration && clip.end > project.duration + 0.5) {
          throw new PublicError("A clip has invalid start or end timing.", 400);
        }
      }
      for (const segment of input.editor.transcript) {
        if (segment.end <= segment.start) throw new PublicError("A transcript segment has invalid timing.", 400);
      }
      project.editor = input.editor as CircumvisionProject["editor"];
    }
    await saveProject(project);
    return NextResponse.json({ project, requestId });
  } catch (error) {
    return apiError(error, requestId, "The project could not be saved.", error instanceof z.ZodError);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    const { projectId } = await context.params;
    await deleteProject(user.id, projectId);
    return NextResponse.json({ ok: true, requestId });
  } catch (error) {
    return apiError(error, requestId, "The project could not be deleted.");
  }
}
