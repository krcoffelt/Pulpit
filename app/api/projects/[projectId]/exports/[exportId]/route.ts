import { NextResponse } from "next/server";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { cancelRenderJob } from "@/lib/render-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string; exportId: string }> };

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
