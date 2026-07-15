import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/api";
import { deleteStorageKey, getJobJson, putJobJson, usesNetlifyBlobs } from "@/lib/job-storage";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = createRequestId();
  const probeKey = `health/${requestId}.json`;
  try {
    await putJobJson(probeKey, { requestId, createdAt: Date.now() });
    const probe = await getJobJson<{ requestId: string }>(probeKey);
    if (probe?.requestId !== requestId) throw new Error("The persistence probe did not round-trip correctly.");
    const aiConfigured = Boolean(process.env.OPENAI_API_KEY);
    return NextResponse.json({
      status: aiConfigured ? "ok" : "degraded",
      requestId,
      version: (process.env.COMMIT_REF || "development").slice(0, 12),
      checks: {
        persistence: "ok",
        storage: usesNetlifyBlobs() ? "durable" : "local-development",
        ai: aiConfigured ? "configured" : "missing-configuration",
      },
    }, {
      status: aiConfigured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logEvent("error", "health.failed", { requestId }, error);
    return NextResponse.json({ status: "unhealthy", requestId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally {
    await deleteStorageKey(probeKey).catch(() => undefined);
  }
}
