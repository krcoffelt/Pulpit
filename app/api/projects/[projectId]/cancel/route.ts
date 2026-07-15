import { NextResponse } from "next/server";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { cancelProcessJob } from "@/lib/process-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    const { projectId } = await context.params;
    const project = await cancelProcessJob(user.id, projectId);
    return NextResponse.json({ project, requestId });
  } catch (error) {
    return apiError(error, requestId, "Processing could not be cancelled.");
  }
}
