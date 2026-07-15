import { apiError, createRequestId } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { getJobBytes } from "@/lib/job-storage";
import { requireProject } from "@/lib/projects";
import { EXPORT_ID_PATTERN, exportMediaKey } from "@/lib/render-jobs";
import { UPLOAD_PART_BYTES } from "@/lib/upload";
import { PublicError } from "@/lib/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string; exportId: string }> };

function parseRange(value: string | null, fileSize: number) {
  if (!value) return { start: 0, end: Math.min(fileSize - 1, UPLOAD_PART_BYTES - 1) };
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start >= fileSize || !Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, fileSize - 1, start + UPLOAD_PART_BYTES - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const user = await requireCircumvisionUser();
    const { projectId, exportId } = await context.params;
    if (!EXPORT_ID_PATTERN.test(exportId)) throw new PublicError("The export identifier is invalid.", 400);
    const project = await requireProject(user.id, projectId);
    const item = project.exports.find((value) => value.id === exportId);
    if (!item || item.status !== "ready" || !item.fileSize) throw new PublicError("This export is not ready yet.", 409);
    const range = parseRange(request.headers.get("range"), item.fileSize);
    if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${item.fileSize}` } });
    const output = await getJobBytes(exportMediaKey(projectId, exportId));
    if (!output || output.byteLength !== item.fileSize) throw new PublicError("The finished export is unavailable.", 410);
    const body = output.slice(range.start, range.end + 1);
    return new Response(body, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${item.fileName.replace(/["\\]/g, "")}"`,
        "Content-Length": String(body.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${item.fileSize}`,
        "Content-Type": "video/mp4",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return apiError(error, requestId, "The export could not be downloaded.");
  }
}
