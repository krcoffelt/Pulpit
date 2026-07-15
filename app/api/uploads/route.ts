import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getJobJson, JOB_ID_PATTERN, jobKey, putJobBytes, putJobJson } from "@/lib/job-storage";
import { MAX_UPLOAD_PARTS, UPLOAD_PART_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headersSchema = z.object({
  jobId: z.string().regex(JOB_ID_PATTERN),
  chunkIndex: z.coerce.number().int().nonnegative(),
  totalChunks: z.coerce.number().int().positive().max(MAX_UPLOAD_PARTS),
});

interface UploadManifest {
  jobId: string;
  totalChunks: number;
  createdAt: number;
  updatedAt: number;
}

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  try {
    const input = headersSchema.parse({
      jobId: request.headers.get("x-upload-id"),
      chunkIndex: request.headers.get("x-chunk-index"),
      totalChunks: request.headers.get("x-total-chunks"),
    });
    if (input.chunkIndex >= input.totalChunks) throw new Error("The upload section number is invalid.");

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > UPLOAD_PART_BYTES) {
      return NextResponse.json({ error: "This upload section is too large.", requestId }, { status: 413 });
    }

    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > UPLOAD_PART_BYTES) {
      return NextResponse.json({ error: "This upload section is empty or too large.", requestId }, { status: 400 });
    }

    const uploadKey = jobKey(input.jobId, "upload.json");
    const existing = await getJobJson<UploadManifest>(uploadKey);
    if (existing && existing.totalChunks !== input.totalChunks) {
      return NextResponse.json({ error: "The upload section count changed. Start the upload again.", requestId }, { status: 409 });
    }

    await putJobBytes(jobKey(input.jobId, `uploads/part-${String(input.chunkIndex).padStart(4, "0")}`), body);
    await putJobJson(uploadKey, {
      jobId: input.jobId,
      totalChunks: input.totalChunks,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    } satisfies UploadManifest);

    return NextResponse.json({ ok: true, chunkIndex: input.chunkIndex, totalChunks: input.totalChunks, requestId });
  } catch (error) {
    const validationError = error instanceof z.ZodError;
    const message = validationError
      ? error.issues[0]?.message || "The upload section was invalid."
      : error instanceof Error ? error.message : "The upload section could not be stored.";
    console.error("[api/uploads] failed", { requestId, message, error });
    return NextResponse.json({ error: message, requestId }, { status: validationError ? 400 : 500 });
  }
}
