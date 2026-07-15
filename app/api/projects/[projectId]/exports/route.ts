import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { createRenderJob } from "@/lib/render-jobs";
import { enforceRateLimit } from "@/lib/rate-limit";
import { dispatchBackgroundJob } from "@/lib/worker-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const clipSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(180),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
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
});

const requestSchema = z.object({
  clip: clipSchema,
  transcript: z.array(z.object({
    id: z.string().min(1).max(100),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    text: z.string().trim().min(1).max(2000),
    speaker: z.string().max(100),
  })).max(20_000),
  settings: z.object({
    aspect: z.enum(["9:16", "4:5", "1:1"]),
    captionPreset: z.enum(["bold", "clean", "minimal"]),
    captionPosition: z.enum(["middle", "bottom"]),
    captionScale: z.number().min(0.7).max(1.35),
    captionsEnabled: z.boolean(),
    highlight: z.boolean(),
    frameMode: z.enum(["fill", "fit"]),
    frameX: z.number().min(-100).max(100).default(0),
    frameY: z.number().min(-100).max(100).default(0),
  }),
}).superRefine(({ clip }, context) => {
  if (clip.end <= clip.start || clip.end - clip.start < 0.5 || clip.end - clip.start > 60.1) {
    context.addIssue({ code: "custom", message: "Export clips must be between 0.5 and 60 seconds.", path: ["clip", "end"] });
  }
});

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    await enforceRateLimit(user.id, "export-create", 30, 24 * 60 * 60 * 1000);
    const { projectId } = await context.params;
    const input = requestSchema.parse(await request.json());
    const { job, projectExport } = await createRenderJob({ ownerId: user.id, projectId, ...input });

    const dispatched = await dispatchBackgroundJob(request, "render", { projectId, exportId: job.id, token: job.token }, requestId);
    if (!dispatched) {
      if (process.env.NODE_ENV !== "development") throw new Error("Background rendering is not available outside Netlify.");
      void import("@/lib/render-worker").then(({ runRenderJob }) => runRenderJob({ projectId, exportId: job.id, token: job.token })).catch((error) => {
        console.error("[render/local] failed", { requestId, projectId, exportId: job.id, error });
      });
    }

    const overlappingSegments = input.transcript.filter((segment) => segment.end > input.clip.start && segment.start < input.clip.end).length;
    console.info("[api/exports] queued", {
      requestId,
      projectId,
      exportId: job.id,
      aspect: input.settings.aspect,
      captionsEnabled: input.settings.captionsEnabled,
      transcriptSegments: input.transcript.length,
      overlappingSegments,
    });
    return NextResponse.json({ export: projectExport, requestId }, { status: 202 });
  } catch (error) {
    return apiError(error, requestId, "The export could not be queued.", error instanceof z.ZodError);
  }
}
