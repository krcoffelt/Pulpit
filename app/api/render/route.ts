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
      error: "This legacy export endpoint has been retired. Queue exports from a saved project so the original sermon never needs to be uploaded again.",
      requestId,
    }, { status: 410 });
  } catch (error) {
    return apiError(error, requestId, "The legacy export endpoint is unavailable.");
  }
}
