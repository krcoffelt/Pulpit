import { NextResponse } from "next/server";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { createProcessJob, failProcessJobDispatch, markProcessJobDispatched } from "@/lib/process-jobs";
import { enforceRateLimit } from "@/lib/rate-limit";
import { dispatchBackgroundJob } from "@/lib/worker-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    await enforceRateLimit(user.id, "process-create", 20, 24 * 60 * 60 * 1000);
    const { projectId } = await context.params;
    const { job, shouldStart } = await createProcessJob(user.id, projectId);
    let dispatched: "external" | "netlify" | null = null;
    if (shouldStart) {
      try {
        dispatched = await dispatchBackgroundJob(request, "process", { projectId, token: job.token }, requestId);
        if (!dispatched) {
          if (process.env.NODE_ENV !== "development") throw new Error("Background processing is not available outside Netlify.");
          void import("@/lib/process-worker").then(({ runProcessJob }) => runProcessJob({ projectId, token: job.token })).catch((error) => {
            console.error("[process/local] failed", { requestId, projectId, error });
          });
        } else {
          await markProcessJobDispatched(projectId, job.token);
        }
      } catch (error) {
        await failProcessJobDispatch(user.id, projectId, job.token, requestId).catch((cleanupError) => {
          console.error("[api/process] dispatch cleanup failed", { requestId, projectId, cleanupError });
        });
        throw error;
      }
    }
    console.info("[api/process] queued", { requestId, projectId, worker: dispatched || "local" });
    return NextResponse.json({ projectId, status: job.status, requestId }, { status: 202 });
  } catch (error) {
    return apiError(error, requestId, "The sermon could not be queued for processing.");
  }
}
