import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getJobJson, jobKey, putJobJson } from "./job-storage";
import { requireProject, saveProject } from "./projects";
import type { ClipSuggestion, ProjectExport, RenderSettings, TranscriptSegment } from "./types";
import { PublicError } from "./public-error";

export const EXPORT_ID_PATTERN = /^export-[a-f0-9-]{36}$/;

export interface StoredRenderJob {
  id: string;
  projectId: string;
  ownerId: string;
  token: string;
  clip: ClipSuggestion;
  transcript: TranscriptSegment[];
  settings: RenderSettings;
  createdAt: string;
  status: "queued" | "rendering" | "ready" | "failed" | "cancelled";
}

function renderJobKey(projectId: string, exportId: string) {
  if (!EXPORT_ID_PATTERN.test(exportId)) throw new PublicError("The export identifier is invalid.", 400);
  return jobKey(projectId, `renders/${exportId}.json`);
}

export function exportMediaKey(projectId: string, exportId: string) {
  if (!EXPORT_ID_PATTERN.test(exportId)) throw new PublicError("The export identifier is invalid.", 400);
  return jobKey(projectId, `exports/${exportId}.mp4`);
}

function safeExportName(title: string, aspect: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "sermon-short";
  return `${slug}-${aspect.replace(":", "x")}.mp4`;
}

export async function updateProjectExport(ownerId: string, projectId: string, exportId: string, update: Partial<ProjectExport>) {
  const project = await requireProject(ownerId, projectId);
  project.exports = project.exports.map((item) => item.id === exportId ? { ...item, ...update } : item);
  const active = project.exports.some((item) => item.status === "queued" || item.status === "rendering");
  if (!active && project.status === "rendering") {
    project.status = "ready";
    project.stage = "Ready to edit";
    project.progress = 100;
  }
  await saveProject(project);
}

export async function createRenderJob(input: {
  ownerId: string;
  projectId: string;
  clip: ClipSuggestion;
  transcript: TranscriptSegment[];
  settings: RenderSettings;
}) {
  const project = await requireProject(input.ownerId, input.projectId);
  if (project.source.uploadedParts.length !== project.source.totalParts) throw new PublicError("The source upload is incomplete.", 409);
  const id = `export-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const token = randomBytes(32).toString("hex");
  const fileName = safeExportName(input.clip.title, input.settings.aspect);
  const job: StoredRenderJob = { ...input, id, token, createdAt, status: "queued" };
  const projectExport: ProjectExport = { id, clipId: input.clip.id, aspect: input.settings.aspect, status: "queued", fileName, createdAt };
  project.exports.unshift(projectExport);
  project.status = "rendering";
  project.stage = `Queued ${input.settings.aspect} export`;
  await Promise.all([putJobJson(renderJobKey(input.projectId, id), job), saveProject(project)]);
  return { job, projectExport };
}

export async function readRenderJob(projectId: string, exportId: string) {
  return getJobJson<StoredRenderJob>(renderJobKey(projectId, exportId));
}

export async function saveRenderJob(job: StoredRenderJob) {
  await putJobJson(renderJobKey(job.projectId, job.id), job);
}

function verifyToken(actual: string, supplied: string) {
  const actualBytes = Buffer.from(actual);
  const suppliedBytes = Buffer.from(supplied);
  return actualBytes.byteLength === suppliedBytes.byteLength && timingSafeEqual(actualBytes, suppliedBytes);
}

export async function requireRenderJob(projectId: string, exportId: string, token: string) {
  const job = await readRenderJob(projectId, exportId);
  if (!job || !verifyToken(job.token, token)) throw new Error("The render job is invalid or expired.");
  return job;
}

export async function cancelRenderJob(ownerId: string, projectId: string, exportId: string) {
  const project = await requireProject(ownerId, projectId);
  const job = await readRenderJob(projectId, exportId);
  if (!job || job.ownerId !== ownerId) throw new PublicError("This export could not be found.", 404);
  if (job.status === "ready" || job.status === "failed" || job.status === "cancelled") return project.exports.find((item) => item.id === exportId);
  job.status = "cancelled";
  await Promise.all([
    saveRenderJob(job),
    updateProjectExport(ownerId, projectId, exportId, { status: "cancelled", error: undefined }),
  ]);
  return (await requireProject(ownerId, projectId)).exports.find((item) => item.id === exportId);
}
