import { NextResponse } from "next/server";
import { getCircumvisionSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCircumvisionSession();
  return NextResponse.json(session, { headers: { "Cache-Control": "private, no-store" } });
}
