import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, createRequestId, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { projectSourcePartKey, recordUploadedPart, requireProject, validateMediaSignature } from "@/lib/projects";
import { enforceRateLimit } from "@/lib/rate-limit";
import { putJobBytes } from "@/lib/job-storage";
import { MAX_UPLOAD_PARTS, UPLOAD_PART_BYTES } from "@/lib/upload";
import { PublicError } from "@/lib/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headersSchema = z.object({
  projectId: z.string().regex(/^job-[a-f0-9-]{36}$/),
  chunkIndex: z.coerce.number().int().nonnegative(),
  totalChunks: z.coerce.number().int().positive().max(MAX_UPLOAD_PARTS),
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    await enforceRateLimit(user.id, "upload-part", 1_000, 60 * 60 * 1000);
    const input = headersSchema.parse({
      projectId: request.headers.get("x-project-id") || request.headers.get("x-upload-id"),
      chunkIndex: request.headers.get("x-chunk-index"),
      totalChunks: request.headers.get("x-total-chunks"),
    });
    if (input.chunkIndex >= input.totalChunks) throw new PublicError("The upload section number is invalid.", 400);

    const project = await requireProject(user.id, input.projectId);
    if (project.status === "cancelled") {
      return NextResponse.json({ error: "This upload was cancelled.", requestId }, { status: 409 });
    }
    if (project.source.totalParts !== input.totalChunks) {
      return NextResponse.json({ error: "The upload section count changed. Create a new project.", requestId }, { status: 409 });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > UPLOAD_PART_BYTES) {
      return NextResponse.json({ error: "This upload section is too large.", requestId }, { status: 413 });
    }

    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > UPLOAD_PART_BYTES) {
      return NextResponse.json({ error: "This upload section is empty or too large.", requestId }, { status: 400 });
    }

    const expectedBytes = Math.min(
      UPLOAD_PART_BYTES,
      project.source.fileSize - input.chunkIndex * UPLOAD_PART_BYTES,
    );
    if (body.byteLength !== expectedBytes) {
      return NextResponse.json({ error: "This upload section is incomplete.", requestId }, { status: 400 });
    }
    if (input.chunkIndex === 0) validateMediaSignature(new Uint8Array(body), project.source.fileName);

    await putJobBytes(projectSourcePartKey(input.projectId, input.chunkIndex), body);
    const updated = await recordUploadedPart(user.id, input.projectId, input.chunkIndex);

    return NextResponse.json({
      ok: true,
      chunkIndex: input.chunkIndex,
      totalChunks: input.totalChunks,
      uploadedParts: updated.source.uploadedParts,
      requestId,
    });
  } catch (error) {
    return apiError(error, requestId, "The upload section could not be stored.", error instanceof z.ZodError);
  }
}
