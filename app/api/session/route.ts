import { NextResponse } from "next/server";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { getCircumvisionSession } from "@/lib/auth";
import { WORKSPACE_SESSION_COOKIE } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCircumvisionSession(), { headers: { "Cache-Control": "private, no-store" } });
}

// Keep older clients compatible while opening the workspace without credentials.
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    return NextResponse.json({ ...await getCircumvisionSession(), requestId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, requestId, "The workspace could not be opened.");
  }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const response = NextResponse.json({ ...await getCircumvisionSession(), requestId }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(WORKSPACE_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return apiError(error, requestId, "The workspace session could not be cleared.");
  }
}
