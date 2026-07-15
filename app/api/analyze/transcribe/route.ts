import { NextResponse } from "next/server";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    await requireCircumvisionUser();
    return NextResponse.json({ error: "This legacy transcription endpoint is retired. Transcript sections now run inside a durable background job.", requestId }, { status: 410 });
  } catch (error) {
    return apiError(error, requestId, "The request could not be handled.");
  }
}
