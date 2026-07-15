import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId, apiError, requireTrustedMutation } from "@/lib/api";
import { requireCircumvisionUser } from "@/lib/auth";
import { createProject, listProjects, MAX_OWNER_STORAGE_BYTES } from "@/lib/projects";
import { enforceRateLimit } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_PARTS } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const createSchema = z.object({
  title: z.string().trim().max(180).optional(),
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().max(100),
  fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  totalParts: z.number().int().positive().max(MAX_UPLOAD_PARTS),
  targetDuration: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).default(30),
});

export async function GET() {
  const requestId = createRequestId();
  try {
    const user = await requireCircumvisionUser();
    return NextResponse.json({ projects: await listProjects(user.id), requestId });
  } catch (error) {
    return apiError(error, requestId, "Projects could not be loaded.");
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireTrustedMutation(request);
    const user = await requireCircumvisionUser();
    await enforceRateLimit(user.id, "project-create", 30, 24 * 60 * 60 * 1000);
    const input = createSchema.parse(await request.json());
    const existing = await listProjects(user.id);
    const storedBytes = existing.reduce((total, project) => total + project.source.fileSize + project.exports.reduce((sum, item) => sum + (item.fileSize || 0), 0), 0);
    if (existing.length >= 100) return NextResponse.json({ error: "Delete an older project before creating another one.", requestId }, { status: 409 });
    if (storedBytes + input.fileSize > MAX_OWNER_STORAGE_BYTES) return NextResponse.json({ error: "This upload would exceed the 5 GB workspace storage quota. Delete older media first.", requestId }, { status: 413 });
    const project = await createProject({ ownerId: user.id, ...input });
    console.info("[api/projects] created", { requestId, projectId: project.id, ownerId: user.id, bytes: project.source.fileSize });
    return NextResponse.json({ project, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId, "The project could not be created.", error instanceof z.ZodError);
  }
}
