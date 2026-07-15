import { apiError, createRequestId } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { getJobBytes } from "@/lib/job-storage";
import { projectSourcePartKey, requireProject } from "@/lib/projects";
import { UPLOAD_PART_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ projectId: string }> };

function parseRange(value: string | null, fileSize: number) {
  if (!value) return { start: 0, end: Math.min(fileSize - 1, UPLOAD_PART_BYTES - 1) };
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= fileSize || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, fileSize - 1, start + UPLOAD_PART_BYTES - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const user = await requireCircumvisionUser();
    const { projectId } = await context.params;
    const project = await requireProject(user.id, projectId);
    const range = parseRange(request.headers.get("range"), project.source.fileSize);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${project.source.fileSize}`, "X-Request-Id": requestId },
      });
    }

    const firstPart = Math.floor(range.start / UPLOAD_PART_BYTES);
    const lastPart = Math.floor(range.end / UPLOAD_PART_BYTES);
    const chunks: Uint8Array[] = [];
    for (let partIndex = firstPart; partIndex <= lastPart; partIndex += 1) {
      const bytes = await getJobBytes(projectSourcePartKey(projectId, partIndex));
      if (!bytes) throw new Error("The source media is incomplete. Resume the upload.");
      const sliceStart = partIndex === firstPart ? range.start % UPLOAD_PART_BYTES : 0;
      const sliceEnd = partIndex === lastPart ? (range.end % UPLOAD_PART_BYTES) + 1 : bytes.byteLength;
      chunks.push(bytes.slice(sliceStart, sliceEnd));
    }

    const length = range.end - range.start + 1;
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new Response(body, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${project.source.fileSize}`,
        "Content-Type": project.source.fileType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return apiError(error, requestId, "The source media could not be loaded.");
  }
}
