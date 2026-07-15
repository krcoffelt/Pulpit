import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import {
  encodeWorkspaceSession,
  getCircumvisionSession,
  WORKSPACE_SESSION_COOKIE,
  WORKSPACE_SESSION_MAX_AGE,
  workspaceSession,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCircumvisionSession();
  return NextResponse.json(session, { headers: { "Cache-Control": "private, no-store" } });
}

const sessionSchema = z.object({
  email: z.string().trim().email().max(254),
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const { email } = sessionSchema.parse(await request.json());
    const session = workspaceSession(email);
    const response = NextResponse.json({ ...session, requestId }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(WORKSPACE_SESSION_COOKIE, encodeWorkspaceSession(email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: WORKSPACE_SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    return apiError(error, requestId, "The workspace could not be opened.", error instanceof z.ZodError);
  }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const response = NextResponse.json({ authenticated: false, requestId }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(WORKSPACE_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiError(error, requestId, "The workspace session could not be cleared.");
  }
}
