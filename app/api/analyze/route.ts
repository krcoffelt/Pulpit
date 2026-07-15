import { NextResponse } from "next/server";
import { apiError, createRequestId } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const requestId = createRequestId();
  try {
    await requireCircumvisionUser();
    return NextResponse.json({
      error: "This legacy upload endpoint has been retired. Create a project and use resumable upload sections instead.",
      requestId,
    }, { status: 410 });
  } catch (error) {
    return apiError(error, requestId, "The legacy analysis endpoint is unavailable.");
  }
}
