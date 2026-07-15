import { NextResponse } from "next/server";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { requireProject } from "@/lib/projects";
import { PublicError } from "@/lib/public-error";
import { cancelRenderJob, readRenderJob } from "@/lib/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string; exportId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const user = await requireCircumvisionUser();
    const { projectId, exportId } = await context.params;
    await requireProject(user.id, projectId);
    const job = await readRenderJob(projectId, exportId);
    if (!job) throw new PublicError("This export could not be found.", 404);
    const overlappingSegments = job.transcript.filter((segment) => segment.end > job.clip.start && segment.start < job.clip.end);
    const captionCueEstimate = overlappingSegments.reduce((total, segment) => total + Math.ceil(segment.text.trim().split(/\s+/).length / 8), 0);
    return NextResponse.json({
      export: {
        id: job.id,
        status: job.status,
        aspect: job.settings.aspect,
        captionsEnabled: job.settings.captionsEnabled,
        captionPreset: job.settings.captionPreset,
        captionPosition: job.settings.captionPosition,
        captionScale: job.settings.captionScale,
        transcriptSegments: job.transcript.length,
        overlappingSegments: overlappingSegments.length,
        captionCueEstimate,
        clipDuration: Number((job.clip.end - job.clip.start).toFixed(3)),
      },
      requestId,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, requestId, "The export details could not be loaded.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    const { projectId, exportId } = await context.params;
    const item = await cancelRenderJob(user.id, projectId, exportId);
    return NextResponse.json({ export: item, requestId });
  } catch (error) {
    return apiError(error, requestId, "The export could not be cancelled.");
  }
}
