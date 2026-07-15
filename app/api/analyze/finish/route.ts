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
    return NextResponse.json({ error: "This legacy clip-selection endpoint is retired. Use the persisted project's suggestion action instead.", requestId }, { status: 410 });
  } catch (error) {
    return apiError(error, requestId, "The request could not be handled.");
  }
}
