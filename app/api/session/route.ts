import { NextResponse } from "next/server";
import { getCircumvisionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCircumvisionUser();
  return NextResponse.json({
    authenticated: Boolean(user),
    user,
    local: user?.local ?? false,
  });
}
